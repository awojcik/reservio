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
import { and, eq, lt } from "drizzle-orm";

import {
  REDIS_CONNECTION,
  STAY_LIFECYCLE_QUEUE,
  STAY_QUEUE,
  queuePrefix,
  workerConcurrency,
  type StayLifecycleJob,
} from "../../infrastructure/queue/queue.module";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  bookingEvents,
  bookings,
  type BookingEventType,
} from "../../infrastructure/database/schema";
import { NotificationWorker } from "../notifications/application/notification.worker";
import { StayService } from "./stay.service";

export const INSTRUCTIONS_JOB = "stay-instructions-ready";
export const REVEAL_JOB = "sensitive-access-ready";
export const CHECKOUT_JOB = "stay-checkout-reminder";
export const COMPLETE_JOB = "booking-complete";
const SWEEP_JOB = "stay-sweep";

/**
 * The stay lifecycle: tell the Guest what they need, when they need it, and
 * close the Booking once the Stay is over.
 *
 * Every job reloads from PostgreSQL and re-checks its own precondition, so a
 * job that fires late, twice, or after the Booking was cancelled does nothing
 * rather than something wrong (milestone 09 §21).
 */
@Injectable()
export class StayLifecycleWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StayLifecycleWorker.name);
  private worker: Worker<StayLifecycleJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(STAY_QUEUE) private readonly queue: Queue<StayLifecycleJob>,
    @Inject(DATABASE) private readonly database: Database,
    private readonly stay: StayService,
    private readonly notifications: NotificationWorker,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_STAY_WORKER") === "true") return;
    this.start();
    await this.scheduleSweep();
  }

  /** Exposed so tests can drive the worker on their own terms. */
  start(): Worker<StayLifecycleJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<StayLifecycleJob>(
      STAY_LIFECYCLE_QUEUE,
      async (job) => {
        switch (job.name) {
          case INSTRUCTIONS_JOB:
            return this.sendInstructions(job.data.bookingId);
          case REVEAL_JOB:
            return this.announceAccess(job.data.bookingId);
          case CHECKOUT_JOB:
            return this.sendCheckoutReminder(job.data.bookingId);
          case COMPLETE_JOB:
            return this.completeBooking(job.data.bookingId);
          default:
            return this.sweep();
        }
      },
      { connection: this.connection, concurrency: workerConcurrency(this.config, 4), prefix: queuePrefix(this.config) },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "stay.job_failed",
        job: job?.name,
        bookingId: job?.data.bookingId,
        attempts: job?.attemptsMade,
        reason: error.message,
      });
    });

    return this.worker;
  }

  /**
   * Plans the whole stay for a Booking that has just been confirmed.
   *
   * Job ids are derived from the Booking, so re-running this — a replayed
   * webhook, a Host correcting the check-in time — replaces the existing jobs
   * instead of adding a second set (milestone 09 §22).
   */
  async scheduleFor(bookingId: string): Promise<{ scheduled: number }> {
    const schedule = await this.stay.scheduleFor(bookingId);
    if (!schedule) return { scheduled: 0 };

    const plan: [string, Date][] = [
      [INSTRUCTIONS_JOB, schedule.instructionsAt],
      [REVEAL_JOB, schedule.scheduledRevealAt],
      [CHECKOUT_JOB, schedule.checkoutReminderAt],
      [COMPLETE_JOB, schedule.window.checkOutAt],
    ];

    let scheduled = 0;
    for (const [name, at] of plan) {
      await this.replace(name, bookingId, at);
      scheduled += 1;
    }

    this.logger.log({
      event: "stay.scheduled",
      bookingId,
      instructionsAt: schedule.instructionsAt.toISOString(),
      revealAt: schedule.scheduledRevealAt.toISOString(),
      completeAt: schedule.window.checkOutAt.toISOString(),
    });

    return { scheduled };
  }

  /**
   * One job per Booking per kind. Removing the previous one first is what
   * makes rescheduling actually reschedule: BullMQ keeps the original delay of
   * a job whose id already exists.
   */
  private async replace(name: string, bookingId: string, at: Date): Promise<void> {
    const jobId = `${name}-${bookingId}`;
    await this.queue.remove(jobId).catch(() => undefined);

    await this.queue.add(
      name,
      { bookingId },
      { jobId, delay: Math.max(0, at.getTime() - Date.now()) },
    );
  }

  // ------------------------------------------------------------------ jobs

  async sendInstructions(bookingId: string): Promise<{ sent: boolean }> {
    const booking = await this.confirmedBooking(bookingId);
    if (!booking) return { sent: false };

    await this.record(bookingId, "STAY_INSTRUCTIONS_SENT");
    await this.notifications.enqueue(bookingId, "STAY_INSTRUCTIONS_READY");
    return { sent: true };
  }

  /**
   * Announces the access details. The email says they are available, never
   * what they are — email is not a channel we control after sending
   * (milestone 09 §19).
   */
  async announceAccess(bookingId: string): Promise<{ sent: boolean }> {
    const booking = await this.confirmedBooking(bookingId);
    if (!booking) return { sent: false };

    const status = await this.stay.accessStatusFor(booking);
    // Nothing configured means nothing to announce.
    if (!status.configured) return { sent: false };

    await this.notifications.enqueue(bookingId, "SENSITIVE_ACCESS_READY");
    return { sent: true };
  }

  async sendCheckoutReminder(bookingId: string): Promise<{ sent: boolean }> {
    const booking = await this.confirmedBooking(bookingId);
    if (!booking) return { sent: false };

    await this.record(bookingId, "CHECKOUT_REMINDER_SENT");
    await this.notifications.enqueue(bookingId, "STAY_CHECKOUT_REMINDER");
    return { sent: true };
  }

  /**
   * `CONFIRMED → COMPLETED`, once the Stay is actually over in the Property's
   * own time zone.
   *
   * No Guest confirmation anywhere in this path: nobody is asked to announce
   * that they left (milestone 09 §23, §58).
   */
  async completeBooking(bookingId: string): Promise<{ completed: boolean }> {
    const schedule = await this.stay.scheduleFor(bookingId);
    if (!schedule) return { completed: false };

    // Fired early — the Stay is still running.
    if (schedule.window.checkOutAt.getTime() > Date.now()) return { completed: false };

    const updated = await this.database.db
      .update(bookings)
      .set({ status: "COMPLETED", updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "CONFIRMED")))
      .returning({ id: bookings.id });

    if (updated.length === 0) return { completed: false };

    await this.record(bookingId, "BOOKING_COMPLETED");
    this.logger.log({ event: "booking.completed", bookingId });
    return { completed: true };
  }

  /**
   * Safety net for jobs whose delayed entry was lost to a Redis flush.
   *
   * Only completion is swept: a missed reminder is a missed reminder, but a
   * Booking stuck in CONFIRMED months after the Stay would be wrong data.
   */
  async sweep(): Promise<{ completed: number }> {
    const due = await this.database.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, "CONFIRMED"), lt(bookings.checkOut, todayIso())));

    let completed = 0;
    for (const booking of due) {
      const result = await this.completeBooking(booking.id);
      if (result.completed) completed += 1;
    }
    return { completed };
  }

  async scheduleSweep(): Promise<void> {
    const minutes = Number(this.config.get("STAY_SWEEP_MINUTES") ?? 30);

    await this.queue.upsertJobScheduler(
      "stay-sweep",
      { every: minutes * 60 * 1000 },
      { name: SWEEP_JOB, data: { bookingId: "" } },
    );
  }

  private async confirmedBooking(bookingId: string) {
    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "CONFIRMED")))
      .limit(1);

    return booking ?? null;
  }

  private async record(bookingId: string, type: BookingEventType): Promise<void> {
    await this.database.db
      .insert(bookingEvents)
      .values({ bookingId, type, actorType: "SYSTEM" });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}

/** Yesterday's stays are certainly over; the job itself re-checks the hour. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
