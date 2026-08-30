import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database, Executor } from "../../../infrastructure/database/connection";
import {
  amenities,
  properties,
  propertyAmenities,
  propertyImages,
  type PropertyRow,
} from "../../../infrastructure/database/schema";
import {
  MINIMUM_IMAGES,
  evaluatePublishReadiness,
  type PublishReadiness,
  type PublishRequirement,
} from "../../../domain/publish-readiness";
import { slugify, uniqueSlug } from "../../../domain/slug";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import type {
  CreateHostPropertyDto,
  UpdateHostPropertyDto,
} from "./dto/host-property-input.dto";
import type {
  HostPropertyDetailDto,
  HostPropertyImageDto,
  HostPropertySummaryDto,
  PublishErrorDto,
} from "./dto/host-property.dto";

/** Maps a missing requirement onto the field the Host editor can act on. */
const PUBLISH_ERRORS: Record<PublishRequirement, PublishErrorDto> = {
  TITLE: { field: "title", code: "TITLE_REQUIRED" },
  DESCRIPTION: { field: "description", code: "DESCRIPTION_REQUIRED" },
  PROPERTY_TYPE: { field: "propertyType", code: "PROPERTY_TYPE_REQUIRED" },
  LOCATION: { field: "address", code: "LOCATION_REQUIRED" },
  CAPACITY: { field: "capacity", code: "CAPACITY_REQUIRED" },
  PRICE: { field: "pricing", code: "PRICE_REQUIRED" },
  MINIMUM_IMAGES: {
    field: "images",
    code: "MINIMUM_IMAGES_REQUIRED",
    required: MINIMUM_IMAGES,
  },
};

@Injectable()
export class HostPropertiesService {
  private readonly logger = new Logger(HostPropertiesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(hostId: string): Promise<HostPropertySummaryDto[]> {
    const rows = await this.database.db
      .select()
      .from(properties)
      .where(eq(properties.hostId, hostId))
      .orderBy(desc(properties.updatedAt));

    return Promise.all(
      rows.map(async (row) => {
        const images = await this.loadImages(row.id);
        return this.toSummary(row, images);
      }),
    );
  }

  async create(
    hostId: string,
    dto: CreateHostPropertyDto,
  ): Promise<HostPropertyDetailDto> {
    const title = dto.title?.trim() || "Nowy obiekt";
    const slug = await this.buildSlug(title, "");

    const [row] = await this.database.db
      .insert(properties)
      .values({
        hostId,
        slug,
        title,
        propertyType: dto.propertyType ?? "APARTMENT",
        status: "DRAFT",
      })
      .returning();

    this.logger.log({ event: "property.created", propertyId: row.id, hostId });
    return this.toDetail(row, [], []);
  }

  async detail(hostId: string, id: string): Promise<HostPropertyDetailDto> {
    const row = await this.findOwned(hostId, id);
    const [images, codes] = await Promise.all([
      this.loadImages(row.id),
      this.loadAmenityCodes(row.id),
    ]);
    return this.toDetail(row, images, codes);
  }

  /**
   * Partial by design: a DRAFT is saved as the Host fills it in. Publish
   * completeness is not required here (milestone 02 §36).
   */
  async update(
    hostId: string,
    id: string,
    dto: UpdateHostPropertyDto,
  ): Promise<HostPropertyDetailDto> {
    const current = await this.findOwned(hostId, id);

    const patch: Partial<typeof properties.$inferInsert> = { updatedAt: new Date() };

    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.propertyType !== undefined) patch.propertyType = dto.propertyType;
    if (dto.bookingMode !== undefined) patch.bookingMode = dto.bookingMode;

    const address = dto.address;
    if (address) {
      if (address.addressLine1 !== undefined) patch.addressLine1 = address.addressLine1;
      if (address.postalCode !== undefined) patch.postalCode = address.postalCode;
      if (address.city !== undefined) patch.city = address.city;
      if (address.district !== undefined) patch.district = address.district;
      if (address.countryCode !== undefined) patch.countryCode = address.countryCode;
      if (address.timeZone !== undefined) patch.timeZone = address.timeZone;
      if (address.latitude !== undefined) patch.latitude = address.latitude;
      if (address.longitude !== undefined) patch.longitude = address.longitude;
    }

    const capacity = dto.capacity;
    if (capacity) {
      if (capacity.maxGuests !== undefined) patch.maxGuests = capacity.maxGuests;
      if (capacity.bedrooms !== undefined) patch.bedrooms = capacity.bedrooms;
      if (capacity.beds !== undefined) patch.beds = capacity.beds;
      if (capacity.bathrooms !== undefined) patch.bathrooms = capacity.bathrooms;
    }

    const pricing = dto.pricing;
    if (pricing) {
      if (pricing.baseDailyRateAmountMinor !== undefined) {
        patch.baseDailyRateAmountMinor = pricing.baseDailyRateAmountMinor;
      }
      if (pricing.cleaningFeeAmountMinor !== undefined) {
        patch.cleaningFeeAmountMinor = pricing.cleaningFeeAmountMinor;
      }
      if (pricing.currency !== undefined) patch.currency = pricing.currency;
    }

    // The slug follows the title only until the Listing has been public once —
    // after that a stable URL matters more than a tidy one (milestone 02 §43).
    if (current.firstPublishedAt === null) {
      const nextTitle = patch.title ?? current.title;
      const nextCity = patch.city ?? current.city;
      const candidate = slugify(nextTitle, nextCity);
      if (candidate !== current.slug) {
        patch.slug = await this.buildSlug(nextTitle, nextCity, current.id);
      }
    }

    const row = await this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(properties)
        .set(patch)
        .where(eq(properties.id, current.id))
        .returning();

      if (dto.amenities) await this.replaceAmenities(tx, current.id, dto.amenities);
      return updated;
    });

    this.logger.log({ event: "property.updated", propertyId: row.id, hostId });

    const [images, codes] = await Promise.all([
      this.loadImages(row.id),
      this.loadAmenityCodes(row.id),
    ]);
    return this.toDetail(row, images, codes);
  }

  /**
   * Publication is an explicit domain command, never `PATCH status=PUBLISHED`:
   * load → ownership → validate → transition, all server-side.
   */
  async publish(hostId: string, id: string): Promise<HostPropertyDetailDto> {
    const current = await this.findOwned(hostId, id);

    if (current.status === "ARCHIVED") {
      throw new ConflictException("Zarchiwizowanego obiektu nie można opublikować.");
    }

    const [images, codes] = await Promise.all([
      this.loadImages(current.id),
      this.loadAmenityCodes(current.id),
    ]);

    const readiness = this.readinessFor(current, images.length);
    if (!readiness.ready) {
      this.logger.warn({
        event: "property.publish.rejected",
        propertyId: current.id,
        missing: readiness.missing,
      });
      throw new UnprocessableEntityException({
        code: "PROPERTY_NOT_READY_FOR_PUBLISH",
        errors: readiness.missing.map((requirement) => PUBLISH_ERRORS[requirement]),
      });
    }

    const [row] = await this.database.db
      .update(properties)
      .set({
        status: "PUBLISHED",
        updatedAt: new Date(),
        firstPublishedAt: current.firstPublishedAt ?? new Date(),
      })
      .where(eq(properties.id, current.id))
      .returning();

    this.logger.log({ event: "property.published", propertyId: row.id, hostId, slug: row.slug });
    return this.toDetail(row, images, codes);
  }

  /** PUBLISHED → SUSPENDED. A SUSPENDED Listing disappears from public Search. */
  async unpublish(hostId: string, id: string): Promise<HostPropertyDetailDto> {
    const current = await this.findOwned(hostId, id);
    if (current.status !== "PUBLISHED") {
      throw new ConflictException("Tylko opublikowany obiekt można wycofać.");
    }
    return this.transition(hostId, current, "SUSPENDED", "property.unpublished");
  }

  /** Never a hard delete — history is preserved (domain language §21). */
  async archive(hostId: string, id: string): Promise<HostPropertyDetailDto> {
    const current = await this.findOwned(hostId, id);
    return this.transition(hostId, current, "ARCHIVED", "property.archived");
  }

  /**
   * A Property owned by another Host answers 404, not 403 — a 403 would confirm
   * the Property exists (milestone 02 §19).
   */
  async findOwned(hostId: string, id: string): Promise<PropertyRow> {
    const [row] = await this.database.db
      .select()
      .from(properties)
      .where(and(eq(properties.id, id), eq(properties.hostId, hostId)))
      .limit(1);

    if (!row) throw new NotFoundException(`Nie znaleziono Property: ${id}`);
    return row;
  }

  async loadImages(propertyId: string): Promise<HostPropertyImageDto[]> {
    const rows = await this.database.db
      .select()
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId))
      .orderBy(asc(propertyImages.position));

    return rows.map((row) => ({
      id: row.id,
      // object_key is the storage identity; the seeded catalogue still carries
      // plain remote URLs Rezervio does not own.
      url: row.objectKey ? this.storage.getPublicUrl(row.objectKey) : (row.url ?? ""),
      altText: row.altText,
      position: row.position,
    }));
  }

  async loadAmenityCodes(propertyId: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ code: amenities.code })
      .from(propertyAmenities)
      .innerJoin(amenities, eq(amenities.id, propertyAmenities.amenityId))
      .where(eq(propertyAmenities.propertyId, propertyId))
      .orderBy(asc(amenities.code));

    return rows.map((row) => row.code);
  }

  readinessFor(row: PropertyRow, imageCount: number): PublishReadiness {
    return evaluatePublishReadiness({
      title: row.title,
      description: row.description,
      propertyType: row.propertyType,
      countryCode: row.countryCode,
      city: row.city,
      district: row.district,
      timeZone: row.timeZone,
      latitude: row.latitude,
      longitude: row.longitude,
      maxGuests: row.maxGuests,
      beds: row.beds,
      bathrooms: row.bathrooms,
      baseDailyRateAmountMinor: row.baseDailyRateAmountMinor,
      currency: row.currency,
      imageCount,
    });
  }

  private async transition(
    hostId: string,
    current: PropertyRow,
    status: "SUSPENDED" | "ARCHIVED",
    event: string,
  ): Promise<HostPropertyDetailDto> {
    const [row] = await this.database.db
      .update(properties)
      .set({ status, updatedAt: new Date() })
      .where(eq(properties.id, current.id))
      .returning();

    this.logger.log({ event, propertyId: row.id, hostId });

    const [images, codes] = await Promise.all([
      this.loadImages(row.id),
      this.loadAmenityCodes(row.id),
    ]);
    return this.toDetail(row, images, codes);
  }

  /** Replaced wholesale inside the caller's transaction: the DTO is the full set. */
  private async replaceAmenities(
    tx: Executor,
    propertyId: string,
    codes: string[],
  ): Promise<void> {
    await tx.delete(propertyAmenities).where(eq(propertyAmenities.propertyId, propertyId));
    if (codes.length === 0) return;

    // The canonical vocabulary is the domain constant; the table is a join
    // helper, so a code the catalogue never used is created on first use.
    await tx
      .insert(amenities)
      .values(codes.map((code) => ({ code })))
      .onConflictDoNothing({ target: amenities.code });

    const rows = await tx
      .select({ id: amenities.id, code: amenities.code })
      .from(amenities)
      .where(inArray(amenities.code, codes));

    await tx
      .insert(propertyAmenities)
      .values(rows.map((row) => ({ propertyId, amenityId: row.id })));
  }

  private async buildSlug(
    title: string,
    city: string,
    excludeId?: string,
  ): Promise<string> {
    return uniqueSlug(slugify(title, city), async (candidate) => {
      const [taken] = await this.database.db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.slug, candidate))
        .limit(1);
      return Boolean(taken) && taken.id !== excludeId;
    });
  }

  private toSummary(
    row: PropertyRow,
    images: HostPropertyImageDto[],
  ): HostPropertySummaryDto {
    return {
      id: row.id,
      slug: row.slug,
      status: row.status,
      title: row.title,
      city: row.city,
      coverImage: images[0] ?? null,
      pricing: {
        baseDailyRateAmountMinor: row.baseDailyRateAmountMinor,
        cleaningFeeAmountMinor: row.cleaningFeeAmountMinor,
        currency: row.currency,
      },
      updatedAt: row.updatedAt.toISOString(),
      publishReadiness: this.readinessFor(row, images.length),
    };
  }

  private toDetail(
    row: PropertyRow,
    images: HostPropertyImageDto[],
    amenityCodes: string[],
  ): HostPropertyDetailDto {
    return {
      ...this.toSummary(row, images),
      description: row.description,
      propertyType: row.propertyType,
      bookingMode: row.bookingMode,
      address: {
        addressLine1: row.addressLine1,
        postalCode: row.postalCode,
        city: row.city,
        district: row.district,
        countryCode: row.countryCode,
        timeZone: row.timeZone,
        latitude: row.latitude,
        longitude: row.longitude,
      },
      capacity: {
        maxGuests: row.maxGuests,
        bedrooms: row.bedrooms,
        beds: row.beds,
        bathrooms: row.bathrooms,
      },
      amenities: amenityCodes,
      images,
    };
  }
}
