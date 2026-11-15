import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import { bookings, properties, propertyImages } from "../../../infrastructure/database/schema";
import {
  IMAGE_VARIANTS_QUEUE,
  type ImageVariantsJob,
} from "../../../infrastructure/queue/queue.module";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import { VARIANTS_VERSION, variantKeys } from "./image-variants";
import { addOrRetry } from "./pending-variants";

export const CLEANUP_JOB = "cleanup-archived";
export const CLEANUP_SWEEP_JOB = "cleanup-sweep";

/** Often enough that a missed enqueue costs hours, not days; rare enough to be free. */
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

export type CleanupOutcome =
  | { status: "cleaned"; images: number; deleted: number; originalsKept: number }
  | { status: "skipped"; reason: "missing" | "not_archived" | "already_cleaned" };

/**
 * Removes the photos of an ARCHIVED Property from storage.
 *
 * ARCHIVED is terminal: nothing in the API or the UI brings a Property back,
 * so its photos are only cost. Two things are deliberately kept:
 *
 *   - the `property_images` rows, because nothing in Rezervio is hard-deleted
 *     on archive (architecture §Property);
 *   - every original a Booking still points at. `cover_image_url_snapshot`
 *     is the cover as it was when the Guest booked, and it is what "Moje
 *     podróże" shows; deleting it would rewrite a Guest's history.
 *
 * Retried by BullMQ on any storage error, from the top: deleting a key that
 * is already gone succeeds, so a second pass only finishes what the first
 * one started. `images_cleaned_at` is written last, and only then is the work
 * considered done.
 */
@Injectable()
export class ArchivedImagesService {
  private readonly logger = new Logger(ArchivedImagesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(IMAGE_VARIANTS_QUEUE) private readonly queue: Queue<ImageVariantsJob>,
  ) {}

  async requestCleanup(propertyId: string): Promise<void> {
    // Dashed for the reason given at `variantsJobId`.
    await addOrRetry(this.queue, CLEANUP_JOB, { propertyId }, `${CLEANUP_JOB}-${propertyId}`);
  }

  async cleanup(propertyId: string): Promise<CleanupOutcome> {
    const [property] = await this.database.db
      .select({ status: properties.status, imagesCleanedAt: properties.imagesCleanedAt })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);

    if (!property) return { status: "skipped", reason: "missing" };
    // The one guard that matters most: a live Listing never loses its photos.
    if (property.status !== "ARCHIVED") return { status: "skipped", reason: "not_archived" };
    if (property.imagesCleanedAt) return { status: "skipped", reason: "already_cleaned" };

    const images = await this.database.db
      .select({ id: propertyImages.id, objectKey: propertyImages.objectKey })
      .from(propertyImages)
      .where(and(eq(propertyImages.propertyId, propertyId), isNotNull(propertyImages.objectKey)));

    const snapshots = await this.database.db
      .selectDistinct({ url: bookings.coverImageUrlSnapshot })
      .from(bookings)
      .where(and(eq(bookings.propertyId, propertyId), isNotNull(bookings.coverImageUrlSnapshot)));

    // By key suffix rather than whole URL: the public base may have moved
    // between the bucket's origin and CDN names since the Booking was made.
    const protectedOriginal = (objectKey: string) =>
      snapshots.some(({ url }) => url?.endsWith(`/${objectKey}`));

    const ownPrefix = `properties/${propertyId}/`;
    let deleted = 0;
    let originalsKept = 0;

    for (const image of images) {
      const objectKey = image.objectKey!;

      // Keys are minted server-side under the Property's own prefix, so this
      // never fires — and if a row ever said otherwise, deleting another
      // Property's photo would be the worst possible way to find out.
      if (!objectKey.startsWith(ownPrefix)) {
        this.logger.error({
          event: "property.archive.image_foreign_key",
          propertyId,
          imageId: image.id,
        });
        continue;
      }

      const keep = protectedOriginal(objectKey);
      const keys = [
        ...Array.from({ length: VARIANTS_VERSION }, (_, index) =>
          variantKeys(objectKey, index + 1),
        ).flat(),
        ...(keep ? [] : [objectKey]),
      ];

      for (const key of keys) {
        await this.storage.deleteObject(key);
      }

      deleted += keys.length;
      if (keep) originalsKept += 1;
      this.logger.log({
        event: "property.archive.image_cleaned",
        propertyId,
        imageId: image.id,
        deleted: keys.length,
        originalKept: keep,
      });
    }

    await this.database.db
      .update(properties)
      .set({ imagesCleanedAt: new Date() })
      .where(eq(properties.id, propertyId));

    this.logger.log({
      event: "property.archive.images_cleaned",
      propertyId,
      images: images.length,
      deleted,
      originalsKept,
    });

    return { status: "cleaned", images: images.length, deleted, originalsKept };
  }

  /**
   * Archived Properties whose photos are still in storage — an enqueue that
   * failed at archive time, or a job that exhausted its attempts. The sweep
   * is what makes "archived" eventually mean "cleaned" without anyone
   * remembering to check.
   */
  async enqueueDue(): Promise<{ enqueued: number }> {
    const due = await this.database.db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.status, "ARCHIVED"), isNull(properties.imagesCleanedAt)));

    for (const { id } of due) await this.requestCleanup(id);
    return { enqueued: due.length };
  }

  async scheduleSweep(): Promise<void> {
    await this.queue.upsertJobScheduler(
      "archived-images-sweep",
      { every: SWEEP_EVERY_MS },
      { name: CLEANUP_SWEEP_JOB, data: {} },
    );
  }
}
