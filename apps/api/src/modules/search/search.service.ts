import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";

import { countNights } from "../../domain/pricing";
import { overlapCondition } from "../availability/availability.service";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage";
import type { PropertySummaryDto, SearchResponseDto } from "../properties/dto/property.dto";
import type { SearchQueryDto, SortOption } from "./dto/search-query.dto";

type SearchRow = {
  id: string;
  slug: string;
  title: string;
  city: string;
  district: string;
  latitude: number;
  longitude: number;
  rating: number;
  review_count: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  max_guests: number;
  property_type: string;
  distance_to_beach_meters: number | null;
  currency: string;
  accommodation_minor: string | number;
  cleaning_minor: string | number;
  total_minor: string | number;
  market_minor: string | number | null;
  saving_minor: string | number | null;
  amenities: string[] | null;
  cover_object_key: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  total_count: string | number;
};

const num = (value: string | number) =>
  typeof value === "number" ? value : Number(value);

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * One SQL statement does the filtering, pricing, sorting and counting.
   * Nothing is filtered in Node — that is what the GiST/GIN/trigram indexes
   * are for, and it keeps behaviour identical no matter how many Property rows
   * exist.
   */
  async search(query: SearchQueryDto): Promise<SearchResponseDto> {
    const nights = this.resolveNights(query);
    const guests = (query.adults ?? 2) + (query.children ?? 0);
    const limit = query.limit ?? 100;

    const conditions: SQL[] = [
      sql`p.status = 'PUBLISHED'`,
      sql`p.max_guests >= ${guests}`,
    ];

    const destination = query.destination?.trim();
    if (destination) {
      // Full text handles whole words; trigram covers diacritics and typos
      // ("Gdansk" vs "Gdańsk"), which FTS with the 'simple' dictionary cannot.
      conditions.push(sql`(
        p.search_document @@ plainto_tsquery('simple', ${destination})
        OR p.city % ${destination}
        OR p.district % ${destination}
        OR p.title % ${destination}
      )`);
    }

    if (query.propertyType?.length) {
      conditions.push(sql`p.property_type = ANY(${sql.raw(this.textArray(query.propertyType))})`);
    }

    if (query.minBedrooms) conditions.push(sql`p.bedrooms >= ${query.minBedrooms}`);

    if (query.maxBeachDistanceMeters !== undefined) {
      // A Property with no known beach distance cannot satisfy the filter.
      conditions.push(sql`(
        p.distance_to_beach_meters IS NOT NULL
        AND p.distance_to_beach_meters <= ${query.maxBeachDistanceMeters}
      )`);
    }
    if (query.minRating) conditions.push(sql`p.rating >= ${query.minRating}`);

    for (const code of this.requiredAmenities(query)) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM property_amenities pa
        JOIN amenities a ON a.id = pa.amenity_id
        WHERE pa.property_id = p.id AND a.code = ${code}
      )`);
    }

    if (query.maxPrice !== undefined) {
      conditions.push(
        sql`(p.base_daily_rate_amount_minor * ${nights} + p.cleaning_fee_amount_minor) <= ${query.maxPrice}`,
      );
    }

    // Availability is part of the same statement, never a second pass in Node:
    // filtering afterwards would make `total` wrong and defeat the GiST index.
    // Both dates are required together — one alone says nothing about a Stay.
    if (query.checkIn && query.checkOut) {
      conditions.push(
        sql`NOT ${overlapCondition("p", {
          startDate: query.checkIn,
          endDate: query.checkOut,
        })}`,
      );
    }

    const bounds = this.resolveBounds(query);
    if (bounds) {
      // ST_MakeEnvelope + && uses the GiST index rather than scanning rows.
      conditions.push(sql`p.location && ST_MakeEnvelope(
        ${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326
      )::geography`);
    }

    const where = sql.join(conditions, sql` AND `);

    // The projection is wrapped in a subselect because PostgreSQL only accepts
    // output aliases as bare ORDER BY terms — the RECOMMENDED score uses
    // saving_minor and market_minor inside an expression, which needs them to
    // be real columns of an outer query.
    const rows = (await this.database.db.execute(sql`
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
    `)) as unknown as SearchRow[];

    this.logger.log(
      `search executed destination=${destination ?? "-"} sort=${query.sort ?? "RECOMMENDED"} nights=${nights} results=${rows.length}`,
    );

    return {
      items: rows.map((row) => this.toSummary(row, nights)),
      total: rows.length ? num(rows[0].total_count) : 0,
    };
  }

  /** No Stay given → price a single night so the contract stays uniform. */
  private resolveNights(query: SearchQueryDto): number {
    if (!query.checkIn || !query.checkOut) return 1;
    return countNights(query.checkIn, query.checkOut);
  }

  private requiredAmenities(query: SearchQueryDto): string[] {
    const codes = new Set(query.amenities ?? []);
    if (query.pool) codes.add("POOL");
    if (query.parking) codes.add("PARKING");
    return [...codes];
  }

  private resolveBounds(query: SearchQueryDto) {
    const values = [query.north, query.south, query.east, query.west];
    const provided = values.filter((value) => value !== undefined);
    if (provided.length === 0) return null;
    if (provided.length !== 4) {
      throw new BadRequestException(
        "Viewport wymaga kompletu parametrów: north, south, east, west",
      );
    }
    const { north, south, east, west } = query as Required<
      Pick<SearchQueryDto, "north" | "south" | "east" | "west">
    >;
    if (north <= south) {
      throw new BadRequestException("north musi być większe niż south");
    }
    return { north, south, east, west };
  }

  /**
   * RECOMMENDED blends rating, how good the deal is and review volume:
   *
   *   rating * 10  +  savingRatio * 120  +  min(reviewCount, 400) / 400 * 12
   *
   * Deliberately simple and deterministic — the same inputs always give the
   * same order, and each term is readable on its own.
   */
  private orderBy(sort: SortOption): SQL {
    switch (sort) {
      case "LOWEST_PRICE":
        return sql`total_minor ASC, rating DESC`;
      case "HIGHEST_RATING":
        return sql`rating DESC, review_count DESC`;
      case "CLOSEST_TO_BEACH":
        return sql`distance_to_beach_meters ASC NULLS LAST, rating DESC`;
      case "BEST_VALUE":
        return sql`COALESCE(saving_minor, 0) DESC, rating DESC`;
      default:
        return sql`(
          rating * 10
          + COALESCE(saving_minor::numeric / NULLIF(market_minor, 0), 0) * 120
          + LEAST(review_count, 400)::numeric / 400 * 12
        ) DESC, rating DESC`;
    }
  }

  /** Values are validated against a fixed enum before reaching this. */
  private textArray(values: string[]): string {
    return `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
  }

  /** object_key is the storage identity; the seeded catalogue keeps plain URLs. */
  private toCoverImage(row: SearchRow) {
    const url = row.cover_object_key
      ? this.storage.getPublicUrl(row.cover_object_key)
      : row.cover_url;
    return url ? { url, altText: row.cover_alt, position: 0 } : null;
  }

  private toSummary(row: SearchRow, nights: number): PropertySummaryDto {
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
}
