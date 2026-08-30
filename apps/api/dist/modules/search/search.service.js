"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SearchService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const pricing_1 = require("../../domain/pricing");
const availability_service_1 = require("../availability/availability.service");
const database_module_1 = require("../../infrastructure/database/database.module");
const object_storage_1 = require("../storage/object-storage");
const num = (value) => typeof value === "number" ? value : Number(value);
let SearchService = SearchService_1 = class SearchService {
    database;
    storage;
    logger = new common_1.Logger(SearchService_1.name);
    constructor(database, storage) {
        this.database = database;
        this.storage = storage;
    }
    async search(query) {
        const nights = this.resolveNights(query);
        const guests = (query.adults ?? 2) + (query.children ?? 0);
        const limit = query.limit ?? 100;
        const conditions = [
            (0, drizzle_orm_1.sql) `p.status = 'PUBLISHED'`,
            (0, drizzle_orm_1.sql) `p.max_guests >= ${guests}`,
        ];
        const destination = query.destination?.trim();
        if (destination) {
            conditions.push((0, drizzle_orm_1.sql) `(
        p.search_document @@ plainto_tsquery('simple', ${destination})
        OR p.city % ${destination}
        OR p.district % ${destination}
        OR p.title % ${destination}
      )`);
        }
        if (query.propertyType?.length) {
            conditions.push((0, drizzle_orm_1.sql) `p.property_type = ANY(${drizzle_orm_1.sql.raw(this.textArray(query.propertyType))})`);
        }
        if (query.minBedrooms)
            conditions.push((0, drizzle_orm_1.sql) `p.bedrooms >= ${query.minBedrooms}`);
        if (query.maxBeachDistanceMeters !== undefined) {
            conditions.push((0, drizzle_orm_1.sql) `(
        p.distance_to_beach_meters IS NOT NULL
        AND p.distance_to_beach_meters <= ${query.maxBeachDistanceMeters}
      )`);
        }
        if (query.minRating)
            conditions.push((0, drizzle_orm_1.sql) `p.rating >= ${query.minRating}`);
        for (const code of this.requiredAmenities(query)) {
            conditions.push((0, drizzle_orm_1.sql) `EXISTS (
        SELECT 1 FROM property_amenities pa
        JOIN amenities a ON a.id = pa.amenity_id
        WHERE pa.property_id = p.id AND a.code = ${code}
      )`);
        }
        if (query.maxPrice !== undefined) {
            conditions.push((0, drizzle_orm_1.sql) `(p.base_daily_rate_amount_minor * ${nights} + p.cleaning_fee_amount_minor) <= ${query.maxPrice}`);
        }
        if (query.checkIn && query.checkOut) {
            conditions.push((0, drizzle_orm_1.sql) `NOT ${(0, availability_service_1.overlapCondition)("p", {
                startDate: query.checkIn,
                endDate: query.checkOut,
            })}`);
        }
        const bounds = this.resolveBounds(query);
        if (bounds) {
            conditions.push((0, drizzle_orm_1.sql) `p.location && ST_MakeEnvelope(
        ${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326
      )::geography`);
        }
        const where = drizzle_orm_1.sql.join(conditions, (0, drizzle_orm_1.sql) ` AND `);
        const rows = (await this.database.db.execute((0, drizzle_orm_1.sql) `
      SELECT * FROM (
      SELECT
        p.id, p.slug, p.title, p.city, p.district,
        p.latitude, p.longitude,
        p.rating, p.review_count,
        p.bedrooms, p.beds, p.bathrooms, p.max_guests,
        p.property_type, p.distance_to_beach_meters, p.currency,
        (p.base_daily_rate_amount_minor * ${nights})                                     AS accommodation_minor,
        p.cleaning_fee_amount_minor                                                      AS cleaning_minor,
        (p.base_daily_rate_amount_minor * ${nights} + p.cleaning_fee_amount_minor)       AS total_minor,
        CASE WHEN p.market_daily_rate_amount_minor IS NULL THEN NULL
             ELSE p.market_daily_rate_amount_minor * ${nights} + p.cleaning_fee_amount_minor
        END                                                                              AS market_minor,
        CASE WHEN p.market_daily_rate_amount_minor IS NULL THEN NULL
             ELSE GREATEST(0,
               (p.market_daily_rate_amount_minor - p.base_daily_rate_amount_minor) * ${nights})
        END                                                                              AS saving_minor,
        (
          SELECT array_agg(a.code ORDER BY a.code)
          FROM property_amenities pa JOIN amenities a ON a.id = pa.amenity_id
          WHERE pa.property_id = p.id
        )                                                                                AS amenities,
        cover.object_key                                                                 AS cover_object_key,
        cover.url                                                                        AS cover_url,
        cover.alt_text                                                                   AS cover_alt,
        count(*) OVER ()                                                                 AS total_count
      FROM properties p
      LEFT JOIN LATERAL (
        SELECT object_key, url, alt_text FROM property_images
        WHERE property_id = p.id ORDER BY position ASC LIMIT 1
      ) cover ON TRUE
      WHERE ${where}
      ) ranked
      ORDER BY ${this.orderBy(query.sort ?? "RECOMMENDED")}
      LIMIT ${limit}
    `));
        this.logger.log(`search executed destination=${destination ?? "-"} sort=${query.sort ?? "RECOMMENDED"} nights=${nights} results=${rows.length}`);
        return {
            items: rows.map((row) => this.toSummary(row, nights)),
            total: rows.length ? num(rows[0].total_count) : 0,
        };
    }
    resolveNights(query) {
        if (!query.checkIn || !query.checkOut)
            return 1;
        return (0, pricing_1.countNights)(query.checkIn, query.checkOut);
    }
    requiredAmenities(query) {
        const codes = new Set(query.amenities ?? []);
        if (query.pool)
            codes.add("POOL");
        if (query.parking)
            codes.add("PARKING");
        return [...codes];
    }
    resolveBounds(query) {
        const values = [query.north, query.south, query.east, query.west];
        const provided = values.filter((value) => value !== undefined);
        if (provided.length === 0)
            return null;
        if (provided.length !== 4) {
            throw new common_1.BadRequestException("Viewport wymaga kompletu parametrów: north, south, east, west");
        }
        const { north, south, east, west } = query;
        if (north <= south) {
            throw new common_1.BadRequestException("north musi być większe niż south");
        }
        return { north, south, east, west };
    }
    orderBy(sort) {
        switch (sort) {
            case "LOWEST_PRICE":
                return (0, drizzle_orm_1.sql) `total_minor ASC, rating DESC`;
            case "HIGHEST_RATING":
                return (0, drizzle_orm_1.sql) `rating DESC, review_count DESC`;
            case "CLOSEST_TO_BEACH":
                return (0, drizzle_orm_1.sql) `distance_to_beach_meters ASC NULLS LAST, rating DESC`;
            case "BEST_VALUE":
                return (0, drizzle_orm_1.sql) `COALESCE(saving_minor, 0) DESC, rating DESC`;
            default:
                return (0, drizzle_orm_1.sql) `(
          rating * 10
          + COALESCE(saving_minor::numeric / NULLIF(market_minor, 0), 0) * 120
          + LEAST(review_count, 400)::numeric / 400 * 12
        ) DESC, rating DESC`;
        }
    }
    textArray(values) {
        return `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
    }
    toCoverImage(row) {
        const url = row.cover_object_key
            ? this.storage.getPublicUrl(row.cover_object_key)
            : row.cover_url;
        return url ? { url, altText: row.cover_alt, position: 0 } : null;
    }
    toSummary(row, nights) {
        return {
            id: row.id,
            slug: row.slug,
            title: row.title,
            city: row.city,
            district: row.district,
            latitude: row.latitude,
            longitude: row.longitude,
            coverImage: this.toCoverImage(row),
            rating: row.rating,
            reviewCount: row.review_count,
            bedrooms: row.bedrooms,
            beds: row.beds,
            bathrooms: row.bathrooms,
            maxGuests: row.max_guests,
            propertyType: row.property_type,
            amenities: row.amenities ?? [],
            distanceToBeachMeters: row.distance_to_beach_meters,
            price: {
                nights,
                accommodationAmountMinor: num(row.accommodation_minor),
                cleaningFeeAmountMinor: num(row.cleaning_minor),
                totalAmountMinor: num(row.total_minor),
                marketAmountMinor: row.market_minor === null ? null : num(row.market_minor),
                savingAmountMinor: row.saving_minor === null ? null : num(row.saving_minor),
                currency: row.currency,
            },
        };
    }
};
exports.SearchService = SearchService;
exports.SearchService = SearchService = SearchService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(object_storage_1.OBJECT_STORAGE)),
    __metadata("design:paramtypes", [Object, Object])
], SearchService);
//# sourceMappingURL=search.service.js.map