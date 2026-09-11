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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertiesService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const pricing_1 = require("../../domain/pricing");
const availability_service_1 = require("../availability/availability.service");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const object_storage_1 = require("../storage/object-storage");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let PropertiesService = class PropertiesService {
    database;
    storage;
    availability;
    constructor(database, storage, availability) {
        this.database = database;
        this.storage = storage;
        this.availability = availability;
    }
    async findPublished(slugOrId, stay) {
        const { db } = this.database;
        const match = UUID_PATTERN.test(slugOrId)
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.properties.slug, slugOrId), (0, drizzle_orm_1.eq)(schema_1.properties.id, slugOrId))
            : (0, drizzle_orm_1.eq)(schema_1.properties.slug, slugOrId);
        const [property] = await db
            .select()
            .from(schema_1.properties)
            .where((0, drizzle_orm_1.and)(match, (0, drizzle_orm_1.eq)(schema_1.properties.status, "PUBLISHED")))
            .limit(1);
        if (!property) {
            throw new common_1.NotFoundException(`Nie znaleziono Property: ${slugOrId}`);
        }
        const imageRows = await db
            .select({
            objectKey: schema_1.propertyImages.objectKey,
            url: schema_1.propertyImages.url,
            altText: schema_1.propertyImages.altText,
            position: schema_1.propertyImages.position,
        })
            .from(schema_1.propertyImages)
            .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, property.id))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.propertyImages.position));
        const images = imageRows.map((image) => ({
            url: this.resolveImageUrl(image),
            altText: image.altText,
            position: image.position,
        }));
        const codes = await db
            .select({ code: schema_1.amenities.code })
            .from(schema_1.propertyAmenities)
            .innerJoin(schema_1.amenities, (0, drizzle_orm_1.eq)(schema_1.amenities.id, schema_1.propertyAmenities.amenityId))
            .where((0, drizzle_orm_1.eq)(schema_1.propertyAmenities.propertyId, property.id))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.amenities.code));
        if (property.description === null || property.latitude === null || property.longitude === null) {
            throw new common_1.NotFoundException(`Nie znaleziono Property: ${slugOrId}`);
        }
        const price = (0, pricing_1.calculatePriceQuote)({
            baseDailyRateAmountMinor: property.baseDailyRateAmountMinor,
            cleaningFeeAmountMinor: property.cleaningFeeAmountMinor,
            marketDailyRateAmountMinor: property.marketDailyRateAmountMinor,
            currency: property.currency,
        }, stay.checkIn ?? this.defaultCheckIn(), stay.checkOut ?? this.defaultCheckOut());
        const available = stay.checkIn && stay.checkOut
            ? await this.availability.isAvailable(property.id, {
                startDate: stay.checkIn,
                endDate: stay.checkOut,
            })
            : null;
        const [stayInfo] = await db
            .select({
            checkInTime: schema_1.propertyStayInformation.checkInTime,
            checkOutTime: schema_1.propertyStayInformation.checkOutTime,
            houseRules: schema_1.propertyStayInformation.houseRules,
        })
            .from(schema_1.propertyStayInformation)
            .where((0, drizzle_orm_1.eq)(schema_1.propertyStayInformation.propertyId, property.id))
            .limit(1);
        return {
            checkInTime: stayInfo?.checkInTime ?? "15:00",
            checkOutTime: stayInfo?.checkOutTime ?? "11:00",
            houseRules: stayInfo?.houseRules ?? null,
            id: property.id,
            slug: property.slug,
            title: property.title,
            description: property.description,
            city: property.city,
            district: property.district,
            countryCode: property.countryCode,
            timeZone: property.timeZone,
            latitude: property.latitude,
            longitude: property.longitude,
            rating: property.rating,
            reviewCount: property.reviewCount,
            bedrooms: property.bedrooms,
            beds: property.beds,
            bathrooms: property.bathrooms,
            maxGuests: property.maxGuests,
            propertyType: property.propertyType,
            distanceToBeachMeters: property.distanceToBeachMeters,
            amenities: codes.map((row) => row.code),
            images,
            coverImage: images[0] ?? null,
            baseDailyRateAmountMinor: property.baseDailyRateAmountMinor,
            price,
            available,
            bookingMode: property.bookingMode,
        };
    }
    async findPublishedSummary(slugOrId) {
        const match = UUID_PATTERN.test(slugOrId)
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.properties.slug, slugOrId), (0, drizzle_orm_1.eq)(schema_1.properties.id, slugOrId))
            : (0, drizzle_orm_1.eq)(schema_1.properties.slug, slugOrId);
        const [property] = await this.database.db
            .select({ id: schema_1.properties.id, timeZone: schema_1.properties.timeZone })
            .from(schema_1.properties)
            .where((0, drizzle_orm_1.and)(match, (0, drizzle_orm_1.eq)(schema_1.properties.status, "PUBLISHED")))
            .limit(1);
        if (!property) {
            throw new common_1.NotFoundException(`Nie znaleziono Property: ${slugOrId}`);
        }
        return property;
    }
    resolveImageUrl(image) {
        return image.objectKey ? this.storage.getPublicUrl(image.objectKey) : (image.url ?? "");
    }
    defaultCheckIn() {
        return new Date().toISOString().slice(0, 10);
    }
    defaultCheckOut() {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        return tomorrow.toISOString().slice(0, 10);
    }
};
exports.PropertiesService = PropertiesService;
exports.PropertiesService = PropertiesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(object_storage_1.OBJECT_STORAGE)),
    __metadata("design:paramtypes", [Object, Object, availability_service_1.AvailabilityService])
], PropertiesService);
//# sourceMappingURL=properties.service.js.map