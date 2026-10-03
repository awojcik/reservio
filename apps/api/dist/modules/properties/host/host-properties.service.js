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
var HostPropertiesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostPropertiesService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../../infrastructure/database/database.module");
const schema_1 = require("../../../infrastructure/database/schema");
const publish_readiness_1 = require("../../../domain/publish-readiness");
const slug_1 = require("../../../domain/slug");
const geocoding_provider_1 = require("../../geocoding/domain/geocoding-provider");
const object_storage_1 = require("../../storage/object-storage");
const PUBLISH_ERRORS = {
    TITLE: { field: "title", code: "TITLE_REQUIRED" },
    DESCRIPTION: { field: "description", code: "DESCRIPTION_REQUIRED" },
    PROPERTY_TYPE: { field: "propertyType", code: "PROPERTY_TYPE_REQUIRED" },
    LOCATION: { field: "address", code: "LOCATION_REQUIRED" },
    CAPACITY: { field: "capacity", code: "CAPACITY_REQUIRED" },
    PRICE: { field: "pricing", code: "PRICE_REQUIRED" },
    MINIMUM_IMAGES: {
        field: "images",
        code: "MINIMUM_IMAGES_REQUIRED",
        required: publish_readiness_1.MINIMUM_IMAGES,
    },
};
let HostPropertiesService = HostPropertiesService_1 = class HostPropertiesService {
    database;
    storage;
    logger = new common_1.Logger(HostPropertiesService_1.name);
    constructor(database, storage) {
        this.database = database;
        this.storage = storage;
    }
    async list(hostId) {
        const rows = await this.database.db
            .select()
            .from(schema_1.properties)
            .where((0, drizzle_orm_1.eq)(schema_1.properties.hostId, hostId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.properties.updatedAt));
        return Promise.all(rows.map(async (row) => {
            const images = await this.loadImages(row.id);
            return this.toSummary(row, images);
        }));
    }
    async create(hostId, dto) {
        const title = dto.title?.trim() || "Nowy obiekt";
        const slug = await this.buildSlug(title, "");
        const [row] = await this.database.db
            .insert(schema_1.properties)
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
    async detail(hostId, id) {
        const row = await this.findOwned(hostId, id);
        const [images, codes] = await Promise.all([
            this.loadImages(row.id),
            this.loadAmenityCodes(row.id),
        ]);
        return this.toDetail(row, images, codes);
    }
    async update(hostId, id, dto) {
        const current = await this.findOwned(hostId, id);
        const patch = { updatedAt: new Date() };
        if (dto.title !== undefined)
            patch.title = dto.title;
        if (dto.description !== undefined)
            patch.description = dto.description;
        if (dto.propertyType !== undefined)
            patch.propertyType = dto.propertyType;
        if (dto.bookingMode !== undefined)
            patch.bookingMode = dto.bookingMode;
        const address = dto.address;
        if (address) {
            if (address.addressLine1 !== undefined)
                patch.addressLine1 = address.addressLine1;
            if (address.postalCode !== undefined)
                patch.postalCode = address.postalCode;
            if (address.city !== undefined)
                patch.city = address.city;
            if (address.district !== undefined)
                patch.district = address.district;
            if (address.countryCode !== undefined)
                patch.countryCode = address.countryCode;
            if (address.timeZone !== undefined)
                patch.timeZone = address.timeZone;
            const { latitude, longitude } = address;
            if (latitude !== undefined || longitude !== undefined) {
                if (latitude === undefined || longitude === undefined) {
                    throw new common_1.BadRequestException({
                        code: "INCOMPLETE_COORDINATES",
                        message: "Szerokość i długość geograficzną zapisujemy razem.",
                    });
                }
                if (!(0, geocoding_provider_1.isStorableCoordinate)(latitude, longitude)) {
                    throw new common_1.BadRequestException({
                        code: "INVALID_COORDINATES",
                        message: "To nie jest poprawna lokalizacja obiektu.",
                    });
                }
                patch.latitude = latitude;
                patch.longitude = longitude;
            }
        }
        const capacity = dto.capacity;
        if (capacity) {
            if (capacity.maxGuests !== undefined)
                patch.maxGuests = capacity.maxGuests;
            if (capacity.bedrooms !== undefined)
                patch.bedrooms = capacity.bedrooms;
            if (capacity.beds !== undefined)
                patch.beds = capacity.beds;
            if (capacity.bathrooms !== undefined)
                patch.bathrooms = capacity.bathrooms;
        }
        const pricing = dto.pricing;
        if (pricing) {
            if (pricing.baseDailyRateAmountMinor !== undefined) {
                patch.baseDailyRateAmountMinor = pricing.baseDailyRateAmountMinor;
            }
            if (pricing.cleaningFeeAmountMinor !== undefined) {
                patch.cleaningFeeAmountMinor = pricing.cleaningFeeAmountMinor;
            }
            if (pricing.currency !== undefined)
                patch.currency = pricing.currency;
        }
        if (current.firstPublishedAt === null) {
            const nextTitle = patch.title ?? current.title;
            const nextCity = patch.city ?? current.city;
            const candidate = (0, slug_1.slugify)(nextTitle, nextCity);
            if (candidate !== current.slug) {
                patch.slug = await this.buildSlug(nextTitle, nextCity, current.id);
            }
        }
        const row = await this.database.db.transaction(async (tx) => {
            const [updated] = await tx
                .update(schema_1.properties)
                .set(patch)
                .where((0, drizzle_orm_1.eq)(schema_1.properties.id, current.id))
                .returning();
            if (dto.amenities)
                await this.replaceAmenities(tx, current.id, dto.amenities);
            return updated;
        });
        this.logger.log({ event: "property.updated", propertyId: row.id, hostId });
        const [images, codes] = await Promise.all([
            this.loadImages(row.id),
            this.loadAmenityCodes(row.id),
        ]);
        return this.toDetail(row, images, codes);
    }
    async publish(hostId, id) {
        const current = await this.findOwned(hostId, id);
        if (current.status === "ARCHIVED") {
            throw new common_1.ConflictException("Zarchiwizowanego obiektu nie można opublikować.");
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
            throw new common_1.UnprocessableEntityException({
                code: "PROPERTY_NOT_READY_FOR_PUBLISH",
                errors: readiness.missing.map((requirement) => PUBLISH_ERRORS[requirement]),
            });
        }
        const [row] = await this.database.db
            .update(schema_1.properties)
            .set({
            status: "PUBLISHED",
            updatedAt: new Date(),
            firstPublishedAt: current.firstPublishedAt ?? new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.properties.id, current.id))
            .returning();
        this.logger.log({ event: "property.published", propertyId: row.id, hostId, slug: row.slug });
        return this.toDetail(row, images, codes);
    }
    async unpublish(hostId, id) {
        const current = await this.findOwned(hostId, id);
        if (current.status !== "PUBLISHED") {
            throw new common_1.ConflictException("Tylko opublikowany obiekt można wycofać.");
        }
        return this.transition(hostId, current, "SUSPENDED", "property.unpublished");
    }
    async archive(hostId, id) {
        const current = await this.findOwned(hostId, id);
        return this.transition(hostId, current, "ARCHIVED", "property.archived");
    }
    async findOwned(hostId, id) {
        const [row] = await this.database.db
            .select()
            .from(schema_1.properties)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.properties.id, id), (0, drizzle_orm_1.eq)(schema_1.properties.hostId, hostId)))
            .limit(1);
        if (!row)
            throw new common_1.NotFoundException(`Nie znaleziono Property: ${id}`);
        return row;
    }
    async loadImages(propertyId) {
        const rows = await this.database.db
            .select()
            .from(schema_1.propertyImages)
            .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, propertyId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.propertyImages.position));
        return rows.map((row) => ({
            id: row.id,
            url: row.objectKey ? this.storage.getPublicUrl(row.objectKey) : (row.url ?? ""),
            altText: row.altText,
            position: row.position,
        }));
    }
    async loadAmenityCodes(propertyId) {
        const rows = await this.database.db
            .select({ code: schema_1.amenities.code })
            .from(schema_1.propertyAmenities)
            .innerJoin(schema_1.amenities, (0, drizzle_orm_1.eq)(schema_1.amenities.id, schema_1.propertyAmenities.amenityId))
            .where((0, drizzle_orm_1.eq)(schema_1.propertyAmenities.propertyId, propertyId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.amenities.code));
        return rows.map((row) => row.code);
    }
    readinessFor(row, imageCount) {
        return (0, publish_readiness_1.evaluatePublishReadiness)({
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
    async transition(hostId, current, status, event) {
        const [row] = await this.database.db
            .update(schema_1.properties)
            .set({ status, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.properties.id, current.id))
            .returning();
        this.logger.log({ event, propertyId: row.id, hostId });
        const [images, codes] = await Promise.all([
            this.loadImages(row.id),
            this.loadAmenityCodes(row.id),
        ]);
        return this.toDetail(row, images, codes);
    }
    async replaceAmenities(tx, propertyId, codes) {
        await tx.delete(schema_1.propertyAmenities).where((0, drizzle_orm_1.eq)(schema_1.propertyAmenities.propertyId, propertyId));
        if (codes.length === 0)
            return;
        await tx
            .insert(schema_1.amenities)
            .values(codes.map((code) => ({ code })))
            .onConflictDoNothing({ target: schema_1.amenities.code });
        const rows = await tx
            .select({ id: schema_1.amenities.id, code: schema_1.amenities.code })
            .from(schema_1.amenities)
            .where((0, drizzle_orm_1.inArray)(schema_1.amenities.code, codes));
        await tx
            .insert(schema_1.propertyAmenities)
            .values(rows.map((row) => ({ propertyId, amenityId: row.id })));
    }
    async buildSlug(title, city, excludeId) {
        return (0, slug_1.uniqueSlug)((0, slug_1.slugify)(title, city), async (candidate) => {
            const [taken] = await this.database.db
                .select({ id: schema_1.properties.id })
                .from(schema_1.properties)
                .where((0, drizzle_orm_1.eq)(schema_1.properties.slug, candidate))
                .limit(1);
            return Boolean(taken) && taken.id !== excludeId;
        });
    }
    toSummary(row, images) {
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
    toDetail(row, images, amenityCodes) {
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
};
exports.HostPropertiesService = HostPropertiesService;
exports.HostPropertiesService = HostPropertiesService = HostPropertiesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(object_storage_1.OBJECT_STORAGE)),
    __metadata("design:paramtypes", [Object, Object])
], HostPropertiesService);
//# sourceMappingURL=host-properties.service.js.map