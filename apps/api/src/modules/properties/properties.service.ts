import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, or } from "drizzle-orm";

import { calculatePriceQuote } from "../../domain/pricing";
import { AvailabilityService } from "../availability/availability.service";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  amenities,
  properties,
  propertyAmenities,
  propertyImages,
} from "../../infrastructure/database/schema";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage";
import type { PropertyDetailDto } from "./dto/property.dto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StayQuery = {
  checkIn?: string;
  checkOut?: string;
};

@Injectable()
export class PropertiesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Slug is the public identity (docs/rezervio-domain-language.md §8), but a
   * UUID is accepted too so links minted before slugs were public keep working.
   */
  async findPublished(slugOrId: string, stay: StayQuery): Promise<PropertyDetailDto> {
    const { db } = this.database;

    const match = UUID_PATTERN.test(slugOrId)
      ? or(eq(properties.slug, slugOrId), eq(properties.id, slugOrId))
      : eq(properties.slug, slugOrId);

    const [property] = await db
      .select()
      .from(properties)
      .where(and(match, eq(properties.status, "PUBLISHED")))
      .limit(1);

    if (!property) {
      throw new NotFoundException(`Nie znaleziono Property: ${slugOrId}`);
    }

    const imageRows = await db
      .select({
        objectKey: propertyImages.objectKey,
        url: propertyImages.url,
        altText: propertyImages.altText,
        position: propertyImages.position,
      })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, property.id))
      .orderBy(asc(propertyImages.position));

    const images = imageRows.map((image) => ({
      url: this.resolveImageUrl(image),
      altText: image.altText,
      position: image.position,
    }));

    const codes = await db
      .select({ code: amenities.code })
      .from(propertyAmenities)
      .innerJoin(amenities, eq(amenities.id, propertyAmenities.amenityId))
      .where(eq(propertyAmenities.propertyId, property.id))
      .orderBy(asc(amenities.code));

    // Publish validation guarantees these on every PUBLISHED Listing; a row
    // that somehow lacks them is not a complete Listing and must not be served
    // as one.
    if (property.description === null || property.latitude === null || property.longitude === null) {
      throw new NotFoundException(`Nie znaleziono Property: ${slugOrId}`);
    }

    const price = calculatePriceQuote(
      {
        baseDailyRateAmountMinor: property.baseDailyRateAmountMinor,
        cleaningFeeAmountMinor: property.cleaningFeeAmountMinor,
        marketDailyRateAmountMinor: property.marketDailyRateAmountMinor,
        currency: property.currency,
      },
      stay.checkIn ?? this.defaultCheckIn(),
      stay.checkOut ?? this.defaultCheckOut(),
    );

    // Same overlap semantics as Search; a Stay must be complete to mean anything.
    const available =
      stay.checkIn && stay.checkOut
        ? await this.availability.isAvailable(property.id, {
            startDate: stay.checkIn,
            endDate: stay.checkOut,
          })
        : null;

    return {
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

  /**
   * Resolves a public slug (or legacy UUID) to a PUBLISHED Property, without
   * loading images, amenities or a PriceQuote. Used where only identity and
   * publication state matter, such as the public availability endpoint.
   */
  async findPublishedSummary(slugOrId: string): Promise<{ id: string; timeZone: string }> {
    const match = UUID_PATTERN.test(slugOrId)
      ? or(eq(properties.slug, slugOrId), eq(properties.id, slugOrId))
      : eq(properties.slug, slugOrId);

    const [property] = await this.database.db
      .select({ id: properties.id, timeZone: properties.timeZone })
      .from(properties)
      .where(and(match, eq(properties.status, "PUBLISHED")))
      .limit(1);

    if (!property) {
      throw new NotFoundException(`Nie znaleziono Property: ${slugOrId}`);
    }
    return property;
  }

  /** object_key is the storage identity; the seeded catalogue keeps plain URLs. */
  private resolveImageUrl(image: { objectKey: string | null; url: string | null }): string {
    return image.objectKey ? this.storage.getPublicUrl(image.objectKey) : (image.url ?? "");
  }

  /** Without a Stay the page still shows a price; one night is the neutral default. */
  private defaultCheckIn(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private defaultCheckOut(): string {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  }
}
