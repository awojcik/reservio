import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import { properties, propertyImages } from "../../../infrastructure/database/schema";
import {
  IMAGE_VARIANTS_QUEUE,
  type ImageVariantsJob,
} from "../../../infrastructure/queue/queue.module";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import {
  VARIANTS_VERSION,
  VARIANT_CACHE_CONTROL,
  generateVariants,
  variantKey,
  variantKeys,
} from "./image-variants";
import { requestVariants } from "./pending-variants";

export type GenerateOutcome =
  | { status: "generated"; variants: number }
  | { status: "skipped"; reason: "missing" | "current" | "not_stored" | "archived" }
  | { status: "abandoned"; reason: "deleted_meanwhile" | "original_missing" };

/**
 * Turns one uploaded photo into its WebP variants.
 *
 * Idempotent by construction: the row says which version exists, the keys are
 * derived from the row, and writing the same key twice writes the same bytes.
 * A retry after a crash halfway through simply writes everything again.
 */
@Injectable()
export class ImageVariantsService {
  private readonly logger = new Logger(ImageVariantsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(IMAGE_VARIANTS_QUEUE) private readonly queue: Queue<ImageVariantsJob>,
  ) {}

  /** See `requestVariants`: a job that exists is not queued twice. */
  async enqueue(imageId: string): Promise<void> {
    await requestVariants(this.queue, imageId);
  }

  async generate(imageId: string): Promise<GenerateOutcome> {
    const [image] = await this.database.db
      .select({
        id: propertyImages.id,
        propertyId: propertyImages.propertyId,
        objectKey: propertyImages.objectKey,
        variantsVersion: propertyImages.variantsVersion,
        propertyStatus: properties.status,
      })
      .from(propertyImages)
      .innerJoin(properties, eq(properties.id, propertyImages.propertyId))
      .where(eq(propertyImages.id, imageId))
      .limit(1);

    if (!image) return { status: "skipped", reason: "missing" };
    // The seeded catalogue is plain remote URLs; there is no original to read.
    if (!image.objectKey) return { status: "skipped", reason: "not_stored" };
    // A job queued before the archive must not bring back the files the
    // archive cleanup removes.
    if (image.propertyStatus === "ARCHIVED") return { status: "skipped", reason: "archived" };
    if ((image.variantsVersion ?? 0) >= VARIANTS_VERSION) {
      return { status: "skipped", reason: "current" };
    }

    const startedAt = Date.now();
    const original = await this.storage.getObject(image.objectKey);
    if (!original) {
      // Nothing a retry can fix: the row points at a file that is not there.
      this.logger.warn({
        event: "property.image.variants_original_missing",
        propertyId: image.propertyId,
        imageId,
      });
      return { status: "abandoned", reason: "original_missing" };
    }

    const result = await generateVariants(original);

    for (const variant of result.variants) {
      await this.storage.putObject({
        objectKey: variantKey(image.objectKey, VARIANTS_VERSION, variant.name),
        body: variant.body,
        contentType: "image/webp",
        cacheControl: VARIANT_CACHE_CONTROL,
      });
    }

    const updated = await this.database.db
      .update(propertyImages)
      .set({ variantsVersion: VARIANTS_VERSION, width: result.width, height: result.height })
      .where(eq(propertyImages.id, imageId))
      .returning({ id: propertyImages.id });

    if (updated.length === 0) {
      // Deleted while we were working. Its delete already ran without knowing
      // about these files, so they are ours to remove.
      await this.removeVariants(image.objectKey, image.propertyId);
      return { status: "abandoned", reason: "deleted_meanwhile" };
    }

    this.logger.log({
      event: "property.image.variants_generated",
      propertyId: image.propertyId,
      imageId,
      version: VARIANTS_VERSION,
      inputBytes: original.length,
      width: result.width,
      height: result.height,
      variants: Object.fromEntries(
        result.variants.map((variant) => [
          variant.name,
          { width: variant.width, bytes: variant.body.length },
        ]),
      ),
      durationMs: Date.now() - startedAt,
    });

    return { status: "generated", variants: result.variants.length };
  }

  /**
   * Every version this code has ever written, so a photo deleted after a
   * version bump leaves nothing behind. Failures are logged, never thrown:
   * the row is already gone and a stray file is harmless.
   */
  async removeVariants(objectKey: string, propertyId: string): Promise<void> {
    for (let version = 1; version <= VARIANTS_VERSION; version += 1) {
      for (const key of variantKeys(objectKey, version)) {
        try {
          await this.storage.deleteObject(key);
        } catch (error) {
          this.logger.warn({
            event: "property.image.object_orphaned",
            propertyId,
            objectKey: key,
            reason: (error as Error).message,
          });
        }
      }
    }
  }
}
