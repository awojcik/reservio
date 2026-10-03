import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker, type Queue } from "bullmq";
import type { Redis } from "ioredis";
import { and, eq, gt, lt } from "drizzle-orm";

import {
  BOOKING_LIFECYCLE_QUEUE,
  LIFECYCLE_QUEUE,
  REDIS_CONNECTION,
  queuePrefix,
  workerConcurrency,
  type BookingLifecycleJob,
} from "../../infrastructure/queue/queue.module";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { bookings } from "../../infrastructure/database/schema";
import { BookingsService } from "./bookings.service";
import { NotificationWorker } from "../notifications/application/notification.worker";

const EXPIRE_JOB = "expire";
const REMINDER_JOB = "reminder";
const SWEEP_JOB = "sweep";

/**
 * Request-to-Book timing: the reminder before the deadline, and the expiry
 * after it.
 *
 * The deadline in PostgreSQL is what actually decides — this worker only moves
 * rows to their final state and sends the mail (milestone 05 §62).
 */
@Injectable()
export class BookingLifecycleWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BookingLifecycleWorker.name);
  private worker: Worker<BookingLifecycleJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(LIFECYCLE_QUEUE) private readonly queue: Queue<BookingLifecycleJob>,
    @Inject(DATABASE) private readonly database: Database,
    private readonly bookingsService: BookingsService,
    private readonly notifications: NotificationWorker,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_BOOKING_WORKER") === "true") return;
    this.start();
    await this.scheduleSweep();
  }

  start(): Worker<BookingLifecycleJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<BookingLifecycleJob>(
      BOOKING_LIFECYCLE_QUEUE,
      async (job) => {
        if (job.name === SWEEP_JOB) return this.sweep();
        if (job.name === REMINDER_JOB) return this.sendReminder(job.data.bookingId);
        return this.bookingsService.expireBookingRequest(job.data.bookingId);
      },
      { connection: this.connection, concurrency: workerConcurrency(this.config, 4), prefix: queuePrefix(this.config) },
    );

    return this.worker;
  }

  /** Schedules both the reminder and the expiry for a fresh request. */
  async scheduleRequest(bookingId: string, deadlineAt: Date): Promise<void> {
    const remindBefore = Number(
      this.config.get("BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY") ?? 14_400,
    );

    const remindDelay = deadlineAt.getTime() - remindBefore * 1000 - Date.now();
    if (remindDelay > 0) {
      await this.queue.add(
        REMINDER_JOB,
        { bookingId },
        { jobId: `booking-request-reminder-${bookingId}`, delay: remindDelay },
      );
    }

    await this.queue.add(
      EXPIRE_JOB,
      { bookingId },
      {
        // BullMQ rejects ":" in a custom job id.
        jobId: `booking-request-expire-${bookingId}`,
        delay: Math.max(0, deadlineAt.getTime() - Date.now()),
      },
    );
  }

  /**
   * Only nudges a request that is still waiting. A Host who already answered
   * must not be chased (milestone 05 §25).
   */
  async sendReminder(bookingId: string): Promise<{ sent: boolean }> {
    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.status, "PENDING_HOST_APPROVAL"),
          gt(bookings.hostResponseDeadlineAt, new Date()),
        ),
      )
      .limit(1);

    if (!booking) return { sent: false };

    await this.notifications.enqueue(bookingId, "BOOKING_REQUEST_REMINDER");
    return { sent: true };
  }

  /**
   * Catches requests whose delayed job was lost. The deadline column makes this
   * possible without trusting Redis to have remembered anything.
   */
  async sweep(): Promise<{ expired: number }> {
    const due = await this.database.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "PENDING_HOST_APPROVAL"),
          lt(bookings.hostResponseDeadlineAt, new Date()),
        ),
      );

    let expired = 0;
    for (const booking of due) {
      const result = await this.bookingsService.expireBookingRequest(booking.id);
      if (result.expired) expired += 1;
    }
    return { expired };
  }

  async scheduleSweep(): Promise<void> {
    const minutes = Number(this.config.get("BOOKING_REQUEST_SWEEP_MINUTES") ?? 5);

    await this.queue.upsertJobScheduler(
      "booking-request-sweep",
      { every: minutes * 60 * 1000 },
      { name: SWEEP_JOB, data: { bookingId: "" } },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
