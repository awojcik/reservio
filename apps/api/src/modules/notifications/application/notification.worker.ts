import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UnrecoverableError, Worker, type Queue } from "bullmq";
import type { Redis } from "ioredis";

import {
  NOTIFICATION_QUEUE,
  NOTIFICATIONS_QUEUE,
  REDIS_CONNECTION,
  queuePrefix,
  type NotificationJob,
} from "../../../infrastructure/queue/queue.module";
import { OutboxService } from "../../../infrastructure/outbox/outbox.service";
import type { NotificationType } from "../../../infrastructure/database/schema";
import { PermanentEmailError } from "../domain/notification";
import { NotificationsService } from "./notifications.service";

const OUTBOX_JOB = "outbox";
const SEND_JOB = "send";

/**
 * Moves outbox rows onto the queue and sends what lands there.
 *
 * Two stages on purpose: the outbox guarantees the intent survives the commit,
 * and BullMQ gives retries and backoff. Neither is the source of truth for
 * Booking state.
 */
@Injectable()
export class NotificationWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationWorker.name);
  private worker: Worker<NotificationJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationJob>,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_NOTIFICATION_WORKER") === "true") return;
    this.start();
    await this.scheduleOutboxPump();
  }

  /** Exposed so tests can drive the worker on their own terms. */
  start(): Worker<NotificationJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<NotificationJob>(
      NOTIFICATION_QUEUE,
      async (job) => {
        if (job.name === OUTBOX_JOB) return this.pumpOutbox();

        try {
          return await this.notifications.deliver(
            job.data.bookingId,
            job.data.type as NotificationType,
          );
        } catch (error) {
          // A rejected address will be rejected every time; the delivery row is
          // already marked FAILED, so retrying only wastes attempts.
          if (error instanceof PermanentEmailError) {
            throw new UnrecoverableError(`${error.code}: ${error.message}`);
          }
          throw error;
        }
      },
      { connection: this.connection, concurrency: 4, prefix: queuePrefix(this.config) },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "notification.job_failed",
        jobId: job?.id,
        attempts: job?.attemptsMade,
        reason: error.message,
      });
    });

    return this.worker;
  }

  /** Frequent, because it is the path every notification takes. */
  async scheduleOutboxPump(): Promise<void> {
    const seconds = Number(this.config.get("OUTBOX_POLL_SECONDS") ?? 5);

    await this.queue.upsertJobScheduler(
      "outbox-pump",
      { every: seconds * 1000 },
      { name: OUTBOX_JOB, data: { bookingId: "", type: "" } },
    );
  }

  /**
   * Drains PENDING outbox rows into the queue.
   *
   * A row that fails to enqueue goes back to PENDING and is picked up next
   * pass, so nothing is lost — at worst a notification is late.
   */
  async pumpOutbox(): Promise<{ enqueued: number }> {
    await this.outbox.recoverStale();

    const claimed = await this.outbox.claimPending();
    let enqueued = 0;

    for (const event of claimed) {
      const type = event.payload.notificationType;
      if (!type) {
        await this.outbox.markProcessed(event.id);
        continue;
      }

      try {
        await this.enqueue(event.payload.bookingId, type as NotificationType);
        await this.outbox.markProcessed(event.id);
        enqueued += 1;
      } catch (error) {
        await this.outbox.markFailed(event.id, (error as Error).message);
      }
    }

    return { enqueued };
  }

  /**
   * One job per logical notification. The id keeps a re-pumped outbox row from
   * queueing the same email twice; the delivery table is the second guard.
   */
  async enqueue(bookingId: string, type: NotificationType): Promise<void> {
    await this.queue.add(
      SEND_JOB,
      { bookingId, type },
      { jobId: `notify-${type.toLowerCase().replace(/_/g, "-")}-${bookingId}` },
    );

    this.logger.log({ event: "notification.enqueued", bookingId, type });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
