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
  BOOKING_HOLD_QUEUE,
  HOLD_QUEUE,
  REDIS_CONNECTION,
  queuePrefix,
  workerConcurrency,
  type BookingHoldJob,
} from "../../infrastructure/queue/queue.module";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { bookingHolds } from "../../infrastructure/database/schema";
import { PaymentCancelScheduler } from "../payments/payment-cancel.scheduler";
import { BookingsService } from "./bookings.service";

/**
 * Expires BookingHolds once their TTL passes.
 *
 * This is cleanup, not correctness: availability already ignores an expired
 * hold the moment it lapses, so a late or failed job cannot cause a Property
 * to stay wrongly blocked (milestone 04 §30).
 */
const SWEEP_JOB = "sweep";

@Injectable()
export class BookingHoldWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BookingHoldWorker.name);
  private worker: Worker<BookingHoldJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(HOLD_QUEUE) private readonly queue: Queue<BookingHoldJob>,
    @Inject(DATABASE) private readonly database: Database,
    private readonly bookings: BookingsService,
    private readonly paymentCancels: PaymentCancelScheduler,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_BOOKING_WORKER") === "true") return;
    this.start();
    await this.scheduleSweep();
  }

  /**
   * A periodic safety net beside the per-hold jobs.
   *
   * Availability is already correct without it — an expired hold stops
   * blocking on its own. What this catches is the *status* drifting: a hold
   * whose delayed job was lost to a Redis flush, or whose TTL was shortened
   * after the job was queued, would otherwise leave its Booking sitting in
   * PENDING_PAYMENT forever.
   */
  async scheduleSweep(): Promise<void> {
    const minutes = Number(this.config.get("BOOKING_HOLD_SWEEP_MINUTES") ?? 5);

    await this.queue.upsertJobScheduler(
      "booking-hold-sweep",
      { every: minutes * 60 * 1000 },
      { name: SWEEP_JOB, data: { holdId: "" } },
    );
  }

  /** Exposed so tests can run a worker on their own terms. */
  start(): Worker<BookingHoldJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<BookingHoldJob>(
      BOOKING_HOLD_QUEUE,
      async (job) => {
        if (job.name === SWEEP_JOB) return this.sweepExpired();
        return this.expire(job.data.holdId);
      },
      {
        connection: this.connection,
        concurrency: workerConcurrency(this.config, 4),
        prefix: queuePrefix(this.config),
      },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "booking.hold.expire_failed",
        jobId: job?.id,
        attempts: job?.attemptsMade,
        reason: error.message,
      });
    });

    return this.worker;
  }

  /**
   * One delayed job per hold, keyed by hold id so a retried command cannot
   * queue the same expiry twice (milestone 04 §28).
   */
  async scheduleExpiry(holdId: string, expiresAt: Date): Promise<void> {
    await this.queue.add(
      "expire",
      { holdId },
      {
        // BullMQ rejects ":" in a custom job id.
        jobId: `booking-hold-expire-${holdId}`,
        delay: Math.max(0, expiresAt.getTime() - Date.now()),
      },
    );
  }

  /**
   * Expires one hold, then tells the provider the intent is dead.
   *
   * Order matters: availability is released by the transaction above, and the
   * provider call is a courtesy afterwards. Waiting for Stripe before freeing
   * the calendar would put a network round trip on the critical path of
   * somebody else's booking (milestone 08 §27).
   */
  private async expire(holdId: string): Promise<{ expired: boolean }> {
    const hold = await this.database.db
      .select({ bookingId: bookingHolds.bookingId })
      .from(bookingHolds)
      .where(eq(bookingHolds.id, holdId))
      .limit(1);

    const result = await this.bookings.expireBookingHold(holdId);

    if (result.expired && hold[0]) {
      await this.paymentCancels.cancelOpenPayments(hold[0].bookingId);
    }

    return result;
  }

  /**
   * Safety net for holds whose job was lost — a Redis flush, a crash between
   * commit and enqueue. Availability is already correct without it; this only
   * moves the rows to their final state.
   */
  async sweepExpired(): Promise<{ expired: number }> {
    const due = await this.database.db
      .select({ id: bookingHolds.id })
      .from(bookingHolds)
      .where(
        and(eq(bookingHolds.status, "ACTIVE"), lt(bookingHolds.expiresAt, new Date())),
      );

    let expired = 0;
    for (const hold of due) {
      const result = await this.expire(hold.id);
      if (result.expired) expired += 1;
    }
    return { expired };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
