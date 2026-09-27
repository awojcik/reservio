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
import { and, eq, lt, or, isNull, sql } from "drizzle-orm";

import {
  CALENDAR_SYNC_QUEUE,
  REDIS_CONNECTION,
  SYNC_QUEUE,
  queuePrefix,
  workerConcurrency,
  type CalendarSyncJob,
} from "../../infrastructure/queue/queue.module";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { externalCalendars } from "../../infrastructure/database/schema";
import { CalendarSyncError, CalendarSyncService } from "./calendar-sync.service";

const SWEEP_JOB = "sweep";
const SYNC_JOB = "sync";

/**
 * Runs the calendar-sync queue in-process. A modular monolith does not need a
 * separate worker deployment yet, and BullMQ keeps the jobs durable in Redis
 * either way.
 */
@Injectable()
export class CalendarSyncWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CalendarSyncWorker.name);
  private worker: Worker<CalendarSyncJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(SYNC_QUEUE) private readonly queue: Queue<CalendarSyncJob>,
    @Inject(DATABASE) private readonly database: Database,
    private readonly sync: CalendarSyncService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tests drive the queue explicitly; a worker racing the assertions would
    // make them flaky rather than meaningful.
    if (this.config.get("DISABLE_CALENDAR_WORKER") === "true") return;

    this.start();
    await this.scheduleSweep();
  }

  /** Exposed so the queue tests can run a worker on their own terms. */
  start(): Worker<CalendarSyncJob> {
    // A closed worker consumes nothing, so returning the cached instance after
    // a shutdown would look alive while quietly processing no jobs.
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<CalendarSyncJob>(
      CALENDAR_SYNC_QUEUE,
      async (job) => {
        if (job.name === SWEEP_JOB) return this.enqueueDueCalendars();

        try {
          return await this.sync.sync(job.data.externalCalendarId);
        } catch (error) {
          // A rejected URL or an unparseable feed will fail identically on
          // every attempt; retrying it just burns the backoff budget and
          // hammers someone else's server (milestone 03 §37).
          if (error instanceof CalendarSyncError && error.permanent) {
            throw new UnrecoverableError(`${error.code}: ${error.message}`);
          }
          throw error;
        }
      },
      {
        connection: this.connection,
        concurrency: workerConcurrency(this.config, 2),
        // Must match the queue, or the worker listens to a different namespace.
        prefix: queuePrefix(this.config),
      },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "calendar.sync.job_failed",
        jobId: job?.id,
        attempts: job?.attemptsMade,
        errorCode: error instanceof CalendarSyncError ? error.code : "UNKNOWN",
      });
    });

    return this.worker;
  }

  /**
   * A repeatable sweep that fans out one job per due calendar, rather than one
   * giant job for all of them — a single slow feed then cannot delay everyone
   * else's sync (milestone 03 §36).
   */
  async scheduleSweep(): Promise<void> {
    const minutes = Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15);

    await this.queue.upsertJobScheduler(
      "calendar-sweep",
      { every: minutes * 60 * 1000 },
      { name: SWEEP_JOB, data: { externalCalendarId: "" } },
    );
  }

  async enqueueDueCalendars(): Promise<{ enqueued: number }> {
    const minutes = Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15);
    const dueBefore = new Date(Date.now() - minutes * 60 * 1000);

    const due = await this.database.db
      .select({ id: externalCalendars.id })
      .from(externalCalendars)
      .where(
        and(
          eq(externalCalendars.status, "ACTIVE"),
          or(
            isNull(externalCalendars.lastSyncSucceededAt),
            lt(externalCalendars.lastSyncSucceededAt, dueBefore),
          ),
          // Give up on a feed that has failed relentlessly; the Host sees the
          // error and can re-enable it by editing the calendar.
          sql`${externalCalendars.consecutiveFailures} < 20`,
        ),
      );

    for (const calendar of due) {
      await this.enqueue(calendar.id, false);
    }

    return { enqueued: due.length };
  }

  /**
   * Deduplicated by jobId, so a Host leaning on "Sync now" produces one job
   * rather than a queue full of identical work (milestone 03 §38).
   *
   * The dedup only covers work that is still *in flight*. BullMQ keeps
   * completed and failed jobs around, and it treats `add` with a known id as a
   * no-op — so without the sweep below, the first sync of a calendar would be
   * its last: every later "Sync now", from the Host panel or from admin
   * support, would silently do nothing (milestone 11 §10).
   */
  async enqueue(
    externalCalendarId: string,
    manual: boolean,
  ): Promise<{ queued: boolean; pendingState?: string }> {
    // BullMQ rejects ":" in a custom job id — it is the separator in its own
    // Redis keys.
    const jobId = `sync-${externalCalendarId}`;

    const previous = await this.queue.getJob(jobId);
    if (previous) {
      const state = await previous.getState();

      // Waiting, delayed and active work is the dedup case: the same sync is
      // already coming, and saying so is more useful than pretending to queue
      // a second one.
      if (state !== "completed" && state !== "failed") {
        return { queued: false, pendingState: state };
      }

      await previous.remove().catch(() => undefined);
    }

    await this.queue.add(SYNC_JOB, { externalCalendarId, manual }, { jobId });
    return { queued: true };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
