import type { Queue } from "bullmq";
import { and, gt, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { Database } from "../../../infrastructure/database/connection";
import { propertyImages } from "../../../infrastructure/database/schema";
import type { ImageVariantsJob } from "../../../infrastructure/queue/queue.module";
import { VARIANTS_VERSION } from "./image-variants";

export const GENERATE_JOB = "generate";

/**
 * One job per photo and version, so a second request for the same work is a
 * no-op.
 *
 * Dashes, not colons: BullMQ refuses a custom id containing `:` — except one
 * with exactly three parts, which it reads as a legacy repeatable-job id. An
 * id that only works because of that exception breaks the day it gains a
 * fourth part.
 */
export function variantsJobId(imageId: string): string {
  return `variants-${imageId}-v${VARIANTS_VERSION}`;
}

/**
 * Asks for one photo's variants.
 *
 * A job that already exists is left alone — it is waiting, running or done —
 * unless it failed for good, in which case it is retried: that is what a
 * backfill is for, and BullMQ would otherwise keep answering "already have
 * that id" forever.
 */
export function requestVariants(
  queue: Queue<ImageVariantsJob>,
  imageId: string,
): Promise<"queued" | "retried" | "exists"> {
  return addOrRetry(queue, GENERATE_JOB, { imageId }, variantsJobId(imageId));
}

/** The same rule for any job with a deterministic id. */
export async function addOrRetry(
  queue: Queue<ImageVariantsJob>,
  name: string,
  data: ImageVariantsJob,
  jobId: string,
): Promise<"queued" | "retried" | "exists"> {
  const existing = await queue.getJob(jobId);

  if (!existing) {
    await queue.add(name, data, { jobId });
    return "queued";
  }
  if (await existing.isFailed()) {
    await existing.retry();
    return "retried";
  }
  return "exists";
}

/**
 * Photos with an original but without the current variants, one keyset page
 * after `afterId`. A long backfill never re-reads a page it already queued; a
 * restarted one starts over, which costs nothing — finished photos no longer
 * match and queued ones are recognised by their job id.
 */
export async function findPendingImages(
  database: Database,
  limit: number,
  afterId?: string,
): Promise<{ id: string }[]> {
  return database.db
    .select({ id: propertyImages.id })
    .from(propertyImages)
    .where(
      and(
        isNotNull(propertyImages.objectKey),
        or(
          isNull(propertyImages.variantsVersion),
          lt(propertyImages.variantsVersion, VARIANTS_VERSION),
        ),
        afterId ? gt(propertyImages.id, afterId) : undefined,
      ),
    )
    .orderBy(propertyImages.id)
    .limit(limit);
}
