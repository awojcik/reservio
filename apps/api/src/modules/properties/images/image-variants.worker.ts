import {
  Injectable,
  Logger,
  Inject,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import {
  IMAGE_VARIANTS_QUEUE_NAME,
  REDIS_CONNECTION,
  queuePrefix,
  workerConcurrency,
  type ImageVariantsJob,
} from "../../../infrastructure/queue/queue.module";
import {
  ArchivedImagesService,
  CLEANUP_JOB,
  CLEANUP_SWEEP_JOB,
} from "./archived-images.service";
import { ImageVariantsService } from "./image-variants.service";

/**
 * Consumes the photo queue — variants for new uploads, cleanup for archived
 * Properties — one job at a time.
 *
 * Concurrency 1 on purpose, whatever `WORKER_CONCURRENCY` says: a resize is
 * pure CPU, and the droplet has exactly one core shared with the API and the
 * database. Variants arriving a few seconds later cost nobody anything; a
 * Guest's request stalling behind four parallel encodes would.
 */
@Injectable()
export class ImageVariantsWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ImageVariantsWorker.name);
  private worker: Worker<ImageVariantsJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly variants: ImageVariantsService,
    private readonly archived: ArchivedImagesService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_IMAGE_WORKER") === "true") return;
    this.start();
    await this.archived.scheduleSweep();
  }

  start(): Worker<ImageVariantsJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<ImageVariantsJob>(
      IMAGE_VARIANTS_QUEUE_NAME,
      (job) => {
        if (job.name === CLEANUP_SWEEP_JOB) return this.archived.enqueueDue();
        if (job.name === CLEANUP_JOB) return this.archived.cleanup(job.data.propertyId!);
        return this.variants.generate(job.data.imageId!);
      },
      {
        connection: this.connection,
        concurrency: workerConcurrency(this.config, 1),
        prefix: queuePrefix(this.config),
      },
    );

    // A failed variant job means slower photos, never missing ones; a failed
    // cleanup leaves files in storage until a retry or the sweep removes them.
    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event:
          job?.name === CLEANUP_JOB
            ? "property.archive.images_cleanup_failed"
            : "property.image.variants_failed",
        imageId: job?.data.imageId,
        propertyId: job?.data.propertyId,
        jobId: job?.id,
        attempts: job?.attemptsMade,
        reason: error.message,
      });
    });

    return this.worker;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
