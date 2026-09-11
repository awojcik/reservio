import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";

/**
 * Redis exists for one reason: running calendar syncs off the request thread,
 * with retries and a schedule. It is never consulted to answer whether a
 * Property is available — that stays in PostgreSQL (milestone 03 §68).
 */
export const CALENDAR_SYNC_QUEUE = "calendar-sync";
export const BOOKING_HOLD_QUEUE = "booking-hold-expire";
export const BOOKING_LIFECYCLE_QUEUE = "booking-lifecycle";
export const NOTIFICATION_QUEUE = "notifications";
export const PAYMENT_REFUND_QUEUE = "payment-refund";
export const PAYMENT_CANCEL_QUEUE = "payment-provider-cancel";
export const STAY_LIFECYCLE_QUEUE = "stay-lifecycle";
export const SETTLEMENT_QUEUE_NAME = "host-settlement";
export const EXTERNAL_SYNC_QUEUE_NAME = "external-sync";

/**
 * Redis key namespace. Tests set their own so a running dev server — which
 * holds a live worker against the same Redis — cannot consume their jobs, and
 * vice versa.
 */
export function queuePrefix(config: { get: (key: string) => string | undefined }): string {
  return config.get("BULLMQ_PREFIX") ?? "rezervio";
}

export const REDIS_CONNECTION = Symbol("REDIS_CONNECTION");
export const SYNC_QUEUE = Symbol("SYNC_QUEUE");
export const HOLD_QUEUE = Symbol("HOLD_QUEUE");
export const LIFECYCLE_QUEUE = Symbol("LIFECYCLE_QUEUE");
export const NOTIFICATIONS_QUEUE = Symbol("NOTIFICATIONS_QUEUE");
export const REFUND_QUEUE = Symbol("REFUND_QUEUE");
export const CANCEL_QUEUE = Symbol("CANCEL_QUEUE");
export const STAY_QUEUE = Symbol("STAY_QUEUE");
export const SETTLEMENT_QUEUE = Symbol("SETTLEMENT_QUEUE");
export const EXTERNAL_QUEUE = Symbol("EXTERNAL_QUEUE");

export type CalendarSyncJob = {
  externalCalendarId: string;
  /** Set when a Host pressed "Sync now", for the log line. */
  manual?: boolean;
};

export type BookingHoldJob = {
  holdId: string;
};

/** Request expiry and reminders. Ids only; the worker reloads from the database. */
export type BookingLifecycleJob = {
  bookingId: string;
};

/** Ids only — Guest details never travel through Redis (milestone 05 §11). */
export type NotificationJob = {
  bookingId: string;
  type: string;
  /**
   * What the notification is *about*, when the Booking alone is not enough.
   * A message notification is per message, not per Booking (milestone 09 §37).
   */
  refId?: string;
};

/**
 * Money moving back to a Guest. The Refund row in PostgreSQL is the decision;
 * this job only carries it out against the provider (milestone 08 §25).
 */
export type PaymentRefundJob = {
  refundId: string;
};

/**
 * Best-effort tidy-up after a hold lapses: tell the provider the intent will
 * not be used. Availability was already released without waiting for this
 * (milestone 08 §27).
 */
export type PaymentCancelJob = {
  paymentId: string;
};

/**
 * The stay lifecycle: instructions, access reveal, checkout reminder and the
 * automatic completion. Ids only; every handler reloads from PostgreSQL, which
 * stays the authority on what should happen (milestone 09 §21).
 */
export type StayLifecycleJob = {
  bookingId: string;
};

/**
 * The Host money lifecycle: release, transfer, reversal and reconciliation.
 * Ids only; every handler reloads from PostgreSQL, which stays the authority
 * on what is owed and to whom (milestone 10 §10).
 */
export type SettlementJob = {
  settlementId?: string;
  transferId?: string;
  reversalId?: string;
};

/**
 * Connectivity with an external PMS or channel manager.
 *
 * Ids only, as everywhere else: the worker reloads the connection and its
 * credentials from PostgreSQL, so no provider secret ever passes through Redis
 * (milestone 12 §38).
 */
export type ExternalSyncJob = {
  connectionId?: string;
  bookingId?: string;
  eventId?: string;
};

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(SYNC_QUEUE) private readonly syncQueue: Queue<CalendarSyncJob>,
    @Inject(HOLD_QUEUE) private readonly holdQueue: Queue<BookingHoldJob>,
    @Inject(LIFECYCLE_QUEUE) private readonly lifecycleQueue: Queue<BookingLifecycleJob>,
    @Inject(NOTIFICATIONS_QUEUE) private readonly notificationQueue: Queue<NotificationJob>,
    @Inject(REFUND_QUEUE) private readonly refundQueue: Queue<PaymentRefundJob>,
    @Inject(CANCEL_QUEUE) private readonly cancelQueue: Queue<PaymentCancelJob>,
    @Inject(STAY_QUEUE) private readonly stayQueue: Queue<StayLifecycleJob>,
    @Inject(SETTLEMENT_QUEUE) private readonly settlementQueue: Queue<SettlementJob>,
    @Inject(EXTERNAL_QUEUE) private readonly externalQueue: Queue<ExternalSyncJob>,
  ) {}

  /** Without this the process keeps an open socket and never exits. */
  async onApplicationShutdown(): Promise<void> {
    await this.syncQueue.close();
    await this.holdQueue.close();
    await this.lifecycleQueue.close();
    await this.notificationQueue.close();
    await this.refundQueue.close();
    await this.cancelQueue.close();
    await this.stayQueue.close();
    await this.settlementQueue.close();
    await this.externalQueue.close();
    this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new IORedis(config.get<string>("REDIS_URL") ?? "redis://localhost:6379", {
          // Required by BullMQ: it blocks on the connection itself.
          maxRetriesPerRequest: null,
        }),
    },
    {
      provide: SYNC_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<CalendarSyncJob> =>
        new Queue<CalendarSyncJob>(CALENDAR_SYNC_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        }),
    },
    {
      provide: HOLD_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<BookingHoldJob> =>
        new Queue<BookingHoldJob>(BOOKING_HOLD_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            // Expiry is a database-driven cleanup, so a couple of attempts is
            // plenty; correctness never depends on the job running at all.
            attempts: 3,
            backoff: { type: "exponential", delay: 10_000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        }),
    },
    {
      provide: LIFECYCLE_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<BookingLifecycleJob> =>
        new Queue<BookingLifecycleJob>(BOOKING_LIFECYCLE_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        }),
    },
    {
      provide: NOTIFICATIONS_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<NotificationJob> =>
        new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            // Five attempts with backoff; the dedup key makes each retry safe.
            attempts: 5,
            backoff: { type: "exponential", delay: 15_000 },
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 500 },
          },
        }),
    },
    {
      provide: REFUND_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<PaymentRefundJob> =>
        new Queue<PaymentRefundJob>(PAYMENT_REFUND_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            // A refund owed to a Guest is worth persisting at; the unique index
            // on (payment_id, reason) keeps every retry to one refund.
            attempts: 10,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 200 },
            removeOnFail: false,
          },
        }),
    },
    {
      provide: CANCEL_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<PaymentCancelJob> =>
        new Queue<PaymentCancelJob>(PAYMENT_CANCEL_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            // Purely cosmetic against the provider; nothing depends on it.
            attempts: 3,
            backoff: { type: "exponential", delay: 20_000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 200 },
          },
        }),
    },
    {
      provide: STAY_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<StayLifecycleJob> =>
        new Queue<StayLifecycleJob>(STAY_LIFECYCLE_QUEUE, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 60_000 },
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 500 },
          },
        }),
    },
    {
      provide: SETTLEMENT_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<SettlementJob> =>
        new Queue<SettlementJob>(SETTLEMENT_QUEUE_NAME, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            // Money owed to a Host is worth persisting at; the database
            // invariants make every retry safe.
            attempts: 10,
            backoff: { type: "exponential", delay: 60_000 },
            removeOnComplete: { count: 500 },
            removeOnFail: false,
          },
        }),
    },
    {
      provide: EXTERNAL_QUEUE,
      inject: [REDIS_CONNECTION, ConfigService],
      useFactory: (connection: Redis, config: ConfigService): Queue<ExternalSyncJob> =>
        new Queue<ExternalSyncJob>(EXTERNAL_SYNC_QUEUE_NAME, {
          connection,
          prefix: queuePrefix(config),
          defaultJobOptions: {
            /*
             * Finite, and generous enough to ride out a provider's bad hour.
             * A push that still fails after this stops retrying and becomes an
             * operational issue instead — an integration that retries forever
             * is a denial-of-service against its own partner
             * (milestone 12 §27).
             */
            attempts: 6,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 200 },
            removeOnFail: false,
          },
        }),
    },
    QueueLifecycle,
  ],
  exports: [
    REDIS_CONNECTION,
    SYNC_QUEUE,
    HOLD_QUEUE,
    LIFECYCLE_QUEUE,
    NOTIFICATIONS_QUEUE,
    REFUND_QUEUE,
    CANCEL_QUEUE,
    STAY_QUEUE,
    SETTLEMENT_QUEUE,
    EXTERNAL_QUEUE,
  ],
})
export class QueueModule {}
