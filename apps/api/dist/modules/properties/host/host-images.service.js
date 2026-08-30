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
var HostImagesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostImagesService = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../../infrastructure/database/database.module");
const schema_1 = require("../../../infrastructure/database/schema");
const object_storage_1 = require("../../storage/object-storage");
const host_image_dto_1 = require("./dto/host-image.dto");
const host_properties_service_1 = require("./host-properties.service");
const EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};
const REORDER_OFFSET = 10_000;
let HostImagesService = HostImagesService_1 = class HostImagesService {
    database;
    storage;
    hostProperties;
    logger = new common_1.Logger(HostImagesService_1.name);
    constructor(database, storage, hostProperties) {
        this.database = database;
        this.storage = storage;
        this.hostProperties = hostProperties;
    }
    async createUploadUrl(hostId, propertyId, dto) {
        await this.hostProperties.findOwned(hostId, propertyId);
        await this.assertRoomForAnotherImage(propertyId);
        const extension = EXTENSIONS[dto.contentType];
        const objectKey = `properties/${propertyId}/${(0, node_crypto_1.randomUUID)()}.${extension}`;
        const upload = await this.storage.createPresignedUpload({
            objectKey,
            contentType: dto.contentType,
        });
        this.logger.log({ event: "property.image.upload_url_issued", propertyId, objectKey });
        return upload;
    }
    async confirm(hostId, propertyId, dto) {
        await this.hostProperties.findOwned(hostId, propertyId);
        this.assertKeyBelongsToProperty(propertyId, dto.objectKey);
        await this.assertRoomForAnotherImage(propertyId);
        const existing = await this.database.db
            .select({ id: schema_1.propertyImages.id })
            .from(schema_1.propertyImages)
            .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.objectKey, dto.objectKey))
            .limit(1);
        if (existing.length === 0) {
            const rows = await this.database.db
                .select({ position: schema_1.propertyImages.position })
                .from(schema_1.propertyImages)
                .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, propertyId))
                .orderBy((0, drizzle_orm_1.asc)(schema_1.propertyImages.position));
            const nextPosition = rows.length ? rows[rows.length - 1].position + 1 : 0;
            await this.database.db.insert(schema_1.propertyImages).values({
                propertyId,
                objectKey: dto.objectKey,
                altText: dto.altText ?? null,
                position: nextPosition,
            });
            this.logger.log({ event: "property.image.added", propertyId, objectKey: dto.objectKey });
        }
        return this.hostProperties.loadImages(propertyId);
    }
    async reorder(hostId, propertyId, imageIds) {
        await this.hostProperties.findOwned(hostId, propertyId);
        const current = await this.database.db
            .select({ id: schema_1.propertyImages.id })
            .from(schema_1.propertyImages)
            .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, propertyId));
        const owned = new Set(current.map((row) => row.id));
        const requested = new Set(imageIds);
        if (requested.size !== imageIds.length) {
            throw new common_1.BadRequestException("Lista zawiera powtórzone identyfikatory zdjęć.");
        }
        if (requested.size !== owned.size || imageIds.some((id) => !owned.has(id))) {
            throw new common_1.BadRequestException("Lista musi zawierać dokładnie wszystkie zdjęcia tego obiektu.");
        }
        await this.database.db.transaction(async (tx) => {
            for (const [index, id] of imageIds.entries()) {
                await tx
                    .update(schema_1.propertyImages)
                    .set({ position: REORDER_OFFSET + index })
                    .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.id, id));
            }
            for (const [index, id] of imageIds.entries()) {
                await tx
                    .update(schema_1.propertyImages)
                    .set({ position: index })
                    .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.id, id));
            }
        });
        this.logger.log({ event: "property.image.reordered", propertyId, count: imageIds.length });
        return this.hostProperties.loadImages(propertyId);
    }
    async remove(hostId, propertyId, imageId) {
        await this.hostProperties.findOwned(hostId, propertyId);
        const [image] = await this.database.db
            .select()
            .from(schema_1.propertyImages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.propertyImages.id, imageId), (0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, propertyId)))
            .limit(1);
        if (!image)
            throw new common_1.NotFoundException("Nie znaleziono zdjęcia.");
        await this.database.db.transaction(async (tx) => {
            await tx.delete(schema_1.propertyImages).where((0, drizzle_orm_1.eq)(schema_1.propertyImages.id, imageId));
            const remaining = await tx
                .select({ id: schema_1.propertyImages.id })
                .from(schema_1.propertyImages)
                .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, propertyId))
                .orderBy((0, drizzle_orm_1.asc)(schema_1.propertyImages.position));
            for (const [index, row] of remaining.entries()) {
                await tx
                    .update(schema_1.propertyImages)
                    .set({ position: REORDER_OFFSET + index })
                    .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.id, row.id));
            }
            for (const [index, row] of remaining.entries()) {
                await tx
                    .update(schema_1.propertyImages)
                    .set({ position: index })
                    .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.id, row.id));
            }
        });
        if (image.objectKey) {
            try {
                await this.storage.deleteObject(image.objectKey);
            }
            catch (error) {
                this.logger.warn({
                    event: "property.image.object_orphaned",
                    propertyId,
                    objectKey: image.objectKey,
                    reason: error.message,
                });
            }
        }
        this.logger.log({ event: "property.image.deleted", propertyId, imageId });
        return this.hostProperties.loadImages(propertyId);
    }
    assertKeyBelongsToProperty(propertyId, objectKey) {
        const pattern = new RegExp(`^properties/${propertyId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`, "i");
        if (!pattern.test(objectKey)) {
            throw new common_1.BadRequestException("objectKey nie należy do tego obiektu.");
        }
    }
    async assertRoomForAnotherImage(propertyId) {
        const rows = await this.database.db
            .select({ id: schema_1.propertyImages.id })
            .from(schema_1.propertyImages)
            .where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, propertyId));
        if (rows.length >= host_image_dto_1.MAX_IMAGES_PER_PROPERTY) {
            throw new common_1.ConflictException(`Obiekt może mieć maksymalnie ${host_image_dto_1.MAX_IMAGES_PER_PROPERTY} zdjęć.`);
        }
    }
};
exports.HostImagesService = HostImagesService;
exports.HostImagesService = HostImagesService = HostImagesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(object_storage_1.OBJECT_STORAGE)),
    __metadata("design:paramtypes", [Object, Object, host_properties_service_1.HostPropertiesService])
], HostImagesService);
//# sourceMappingURL=host-images.service.js.map