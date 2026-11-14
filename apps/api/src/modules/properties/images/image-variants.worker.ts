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
import { ImageVariantsService } from "./image-variants.service";

/**
 * Consumes the photo-variant queue, one photo at a time.
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
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get("DISABLE_IMAGE_WORKER") === "true") return;
    this.start();
  }

  start(): Worker<ImageVariantsJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<ImageVariantsJob>(
      IMAGE_VARIANTS_QUEUE_NAME,
      (job) => this.variants.generate(job.data.imageId),
      {
        connection: this.connection,
        concurrency: workerConcurrency(this.config, 1),
        prefix: queuePrefix(this.config),
      },
    );

    // Until it succeeds the photo is shown from its original, so a failure
    // here is slower photos, never missing ones.
    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "property.image.variants_failed",
        imageId: job?.data.imageId,
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
