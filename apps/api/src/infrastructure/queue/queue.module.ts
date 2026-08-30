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
};

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(SYNC_QUEUE) private readonly syncQueue: Queue<CalendarSyncJob>,
    @Inject(HOLD_QUEUE) private readonly holdQueue: Queue<BookingHoldJob>,
    @Inject(LIFECYCLE_QUEUE) private readonly lifecycleQueue: Queue<BookingLifecycleJob>,
    @Inject(NOTIFICATIONS_QUEUE) private readonly notificationQueue: Queue<NotificationJob>,
  ) {}

  /** Without this the process keeps an open socket and never exits. */
  async onApplicationShutdown(): Promise<void> {
    await this.syncQueue.close();
    await this.holdQueue.close();
    await this.lifecycleQueue.close();
    await this.notificationQueue.close();
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
    QueueLifecycle,
  ],
  exports: [
    REDIS_CONNECTION,
    SYNC_QUEUE,
    HOLD_QUEUE,
    LIFECYCLE_QUEUE,
    NOTIFICATIONS_QUEUE,
  ],
})
export class QueueModule {}
