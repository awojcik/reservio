import { Queue } from "bullmq";
import IORedis from "ioredis";

import { createDatabase } from "./connection";
import { loadEnv } from "../config/load-env";
import {
  IMAGE_VARIANTS_QUEUE_NAME,
  queuePrefix,
  type ImageVariantsJob,
} from "../queue/queue.module";
import {
  findPendingImages,
  requestVariants,
} from "../../modules/properties/images/pending-variants";
import { VARIANTS_VERSION } from "../../modules/properties/images/image-variants";

loadEnv();

const BATCH_SIZE = 100;

/**
 * Queues variant generation for photos uploaded before variants existed, or
 * before the current variant version.
 *
 * It only queues. The work itself is done by the worker, one photo at a time,
 * exactly as for a fresh upload — so a backfill of a thousand photos is a
 * thousand small jobs the droplet works through at its own pace, not a script
 * pinning the CPU from a shell. Safe to stop and run again: finished photos
 * drop out of the query and queued ones are recognised by their job id.
 *
 *   pnpm --filter @rezervio/api image:backfill [--dry-run]
 *   podman exec rezervio-api node dist/infrastructure/database/image-variants-backfill.js [--dry-run]
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const database = createDatabase();
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue<ImageVariantsJob>(IMAGE_VARIANTS_QUEUE_NAME, {
    connection,
    prefix: queuePrefix({ get: (key) => process.env[key] }),
  });

  const totals = { pending: 0, queued: 0, retried: 0, exists: 0 };

  try {
    let afterId: string | undefined;
    for (;;) {
      const page = await findPendingImages(database, BATCH_SIZE, afterId);
      if (page.length === 0) break;

      totals.pending += page.length;
      if (!dryRun) {
        for (const { id } of page) {
          totals[await requestVariants(queue, id)] += 1;
        }
      }

      afterId = page[page.length - 1].id;
      console.log(
        dryRun
          ? `… ${totals.pending} zdjęć bez wariantów v${VARIANTS_VERSION}`
          : `… ${totals.pending} przejrzanych: ${totals.queued} w kolejce, ${totals.retried} ponowionych, ${totals.exists} już zleconych`,
      );
    }

    console.log(
      dryRun
        ? `Dry run: ${totals.pending} zdjęć czeka na warianty v${VARIANTS_VERSION}. Nic nie zostało zlecone.`
        : `Gotowe: ${totals.queued} zleconych, ${totals.retried} ponowionych, ${totals.exists} już w kolejce. Worker przetwarza je po jednym.`,
    );
  } finally {
    await queue.close();
    connection.disconnect();
    await database.client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Backfill wariantów nie powiódł się:", error);
  process.exit(1);
});
