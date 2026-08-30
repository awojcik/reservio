import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import { propertyImages } from "../../../infrastructure/database/schema";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import {
  MAX_IMAGES_PER_PROPERTY,
  type ConfirmImageDto,
  type CreateUploadUrlDto,
  type UploadUrlDto,
} from "./dto/host-image.dto";
import type { HostPropertyImageDto } from "./dto/host-property.dto";
import { HostPropertiesService } from "./host-properties.service";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Positions are shifted above any real value before being rewritten, because
 *  (property_id, position) is unique and must stay so mid-reorder. */
const REORDER_OFFSET = 10_000;

@Injectable()
export class HostImagesService {
  private readonly logger = new Logger(HostImagesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly hostProperties: HostPropertiesService,
  ) {}

  /**
   * The key is minted server-side from the Property id, so a confirmed upload
   * can only ever land on the Property the Host actually owns. The original
   * file name is never the final key (milestone 02 §53).
   */
  async createUploadUrl(
    hostId: string,
    propertyId: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlDto> {
    await this.hostProperties.findOwned(hostId, propertyId);
    await this.assertRoomForAnotherImage(propertyId);

    const extension = EXTENSIONS[dto.contentType];
    const objectKey = `properties/${propertyId}/${randomUUID()}.${extension}`;

    const upload = await this.storage.createPresignedUpload({
      objectKey,
      contentType: dto.contentType,
    });

    // The presigned URL itself is deliberately absent from the log line.
    this.logger.log({ event: "property.image.upload_url_issued", propertyId, objectKey });
    return upload;
  }

  async confirm(
    hostId: string,
    propertyId: string,
    dto: ConfirmImageDto,
  ): Promise<HostPropertyImageDto[]> {
    await this.hostProperties.findOwned(hostId, propertyId);
    this.assertKeyBelongsToProperty(propertyId, dto.objectKey);
    await this.assertRoomForAnotherImage(propertyId);

    const existing = await this.database.db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(eq(propertyImages.objectKey, dto.objectKey))
      .limit(1);

    // Confirming the same upload twice must not create a duplicate row.
    if (existing.length === 0) {
      const rows = await this.database.db
        .select({ position: propertyImages.position })
        .from(propertyImages)
        .where(eq(propertyImages.propertyId, propertyId))
        .orderBy(asc(propertyImages.position));

      const nextPosition = rows.length ? rows[rows.length - 1].position + 1 : 0;

      await this.database.db.insert(propertyImages).values({
        propertyId,
        objectKey: dto.objectKey,
        altText: dto.altText ?? null,
        position: nextPosition,
      });

      this.logger.log({ event: "property.image.added", propertyId, objectKey: dto.objectKey });
    }

    return this.hostProperties.loadImages(propertyId);
  }

  /**
   * All-or-nothing: the request must name exactly the Property's images, once
   * each, so a stale client cannot silently drop one.
   */
  async reorder(
    hostId: string,
    propertyId: string,
    imageIds: string[],
  ): Promise<HostPropertyImageDto[]> {
    await this.hostProperties.findOwned(hostId, propertyId);

    const current = await this.database.db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId));

    const owned = new Set(current.map((row) => row.id));
    const requested = new Set(imageIds);

    if (requested.size !== imageIds.length) {
      throw new BadRequestException("Lista zawiera powtórzone identyfikatory zdjęć.");
    }
    if (requested.size !== owned.size || imageIds.some((id) => !owned.has(id))) {
      throw new BadRequestException(
        "Lista musi zawierać dokładnie wszystkie zdjęcia tego obiektu.",
      );
    }

    await this.database.db.transaction(async (tx) => {
      for (const [index, id] of imageIds.entries()) {
        await tx
          .update(propertyImages)
          .set({ position: REORDER_OFFSET + index })
          .where(eq(propertyImages.id, id));
      }
      for (const [index, id] of imageIds.entries()) {
        await tx
          .update(propertyImages)
          .set({ position: index })
          .where(eq(propertyImages.id, id));
      }
    });

    this.logger.log({ event: "property.image.reordered", propertyId, count: imageIds.length });
    return this.hostProperties.loadImages(propertyId);
  }

  /**
   * The database transaction commits before the object is touched: a transient
   * storage failure must never leave the Property in a broken state. A file
   * that outlives its row is harmless and recorded for later cleanup.
   */
  async remove(
    hostId: string,
    propertyId: string,
    imageId: string,
  ): Promise<HostPropertyImageDto[]> {
    await this.hostProperties.findOwned(hostId, propertyId);

    const [image] = await this.database.db
      .select()
      .from(propertyImages)
      .where(
        and(eq(propertyImages.id, imageId), eq(propertyImages.propertyId, propertyId)),
      )
      .limit(1);

    if (!image) throw new NotFoundException("Nie znaleziono zdjęcia.");

    await this.database.db.transaction(async (tx) => {
      await tx.delete(propertyImages).where(eq(propertyImages.id, imageId));

      // Close the gap so position stays a dense 0..n-1 sequence and position 0
      // always names the cover.
      const remaining = await tx
        .select({ id: propertyImages.id })
        .from(propertyImages)
        .where(eq(propertyImages.propertyId, propertyId))
        .orderBy(asc(propertyImages.position));

      for (const [index, row] of remaining.entries()) {
        await tx
          .update(propertyImages)
          .set({ position: REORDER_OFFSET + index })
          .where(eq(propertyImages.id, row.id));
      }
      for (const [index, row] of remaining.entries()) {
        await tx
          .update(propertyImages)
          .set({ position: index })
          .where(eq(propertyImages.id, row.id));
      }
    });

    if (image.objectKey) {
      try {
        await this.storage.deleteObject(image.objectKey);
      } catch (error) {
        this.logger.warn({
          event: "property.image.object_orphaned",
          propertyId,
          objectKey: image.objectKey,
          reason: (error as Error).message,
        });
      }
    }

    this.logger.log({ event: "property.image.deleted", propertyId, imageId });
    return this.hostProperties.loadImages(propertyId);
  }

  private assertKeyBelongsToProperty(propertyId: string, objectKey: string): void {
    const pattern = new RegExp(
      `^properties/${propertyId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`,
      "i",
    );
    if (!pattern.test(objectKey)) {
      throw new BadRequestException("objectKey nie należy do tego obiektu.");
    }
  }

  private async assertRoomForAnotherImage(propertyId: string): Promise<void> {
    const rows = await this.database.db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId));

    if (rows.length >= MAX_IMAGES_PER_PROPERTY) {
      throw new ConflictException(
        `Obiekt może mieć maksymalnie ${MAX_IMAGES_PER_PROPERTY} zdjęć.`,
      );
    }
  }
}
