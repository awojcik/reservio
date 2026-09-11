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
import { and, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  EXTERNAL_QUEUE,
  EXTERNAL_SYNC_QUEUE_NAME,
  REDIS_CONNECTION,
  queuePrefix,
  type ExternalSyncJob,
} from "../../../infrastructure/queue/queue.module";
import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  externalInventoryConnections,
  externalProviderEvents,
} from "../../../infrastructure/database/schema";
import { OutboxService } from "../../../infrastructure/outbox/outbox.service";
import { PartnerAccessRequiredError, ProviderError } from "../domain/provider-errors";
import { ConnectionsService } from "./connections.service";
import { InventorySyncService } from "./inventory-sync.service";
import { OutboundReservationsService } from "./outbound-reservations.service";
import { ProviderEventsService } from "./provider-events.service";

export const SYNC_JOB = "external-provider-sync";
export const RECONCILE_JOB = "external-provider-reconciliation";
export const PUSH_JOB = "external-reservation-push";
export const CANCEL_JOB = "external-reservation-cancel";
export const WEBHOOK_JOB = "external-provider-webhook-process";
const OUTBOX_JOB = "external-outbox";
const SWEEP_JOB = "external-sweep";

/** Outbox event types this worker owns. The notification pump owns its own. */
export const OUTBOX_TYPES = [
  "EXTERNAL_RESERVATION_PUSH",
  "EXTERNAL_RESERVATION_CANCEL",
] as const;

/** Batches, so a growing table never becomes a full scan. */
const BATCH = 50;

/**
 * Everything connectivity does off the request thread.
 *
 * Five job kinds, all of them idempotent at the layer below: a duplicated
 * sync converges on the same blocks, a duplicated push loses the claim, a
 * duplicated webhook loses the event insert (milestone 12 §27, §35).
 */
@Injectable()
export class ExternalSyncWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ExternalSyncWorker.name);
  private worker: Worker<ExternalSyncJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(EXTERNAL_QUEUE) private readonly queue: Queue<ExternalSyncJob>,
    @Inject(DATABASE) private readonly database: Database,
    private readonly connections: ConnectionsService,
    private readonly sync: InventorySyncService,
    private readonly outbound: OutboundReservationsService,
    private readonly events: ProviderEventsService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_EXTERNAL_WORKER") === "true") return;
    this.start();
    await this.scheduleSweep();
  }

  /** Exposed so tests can drive the worker on their own terms. */
  start(): Worker<ExternalSyncJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<ExternalSyncJob>(
      EXTERNAL_SYNC_QUEUE_NAME,
      async (job) => {
        switch (job.name) {
          case SYNC_JOB:
            return this.runSync(job.data.connectionId!);
          case RECONCILE_JOB:
            return this.runReconcile(job.data.connectionId!);
          case PUSH_JOB:
            return this.runPush(job.data.bookingId!);
          case CANCEL_JOB:
            return this.outbound.cancelBooking(job.data.bookingId!);
          case WEBHOOK_JOB:
            return this.events.process(job.data.eventId!);
          case OUTBOX_JOB:
            return this.pumpOutbox();
          default:
            return this.sweep();
        }
      },
      { connection: this.connection, concurrency: 2, prefix: queuePrefix(this.config) },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "connectivity.job_failed",
        job: job?.name,
        attempts: job?.attemptsMade,
        code: error instanceof ProviderError ? error.code : "UNEXPECTED",
      });
    });

    return this.worker;
  }

  // ------------------------------------------------------------- enqueueing

  /**
   * One sync job per connection, deduplicated by id.
   *
   * A finished job's id is released first: BullMQ treats `add` with a known id
   * as a no-op, which would make the first sync of a connection its last.
   */
  async enqueueSync(connectionId: string): Promise<{ queued: boolean }> {
    return this.enqueue(SYNC_JOB, `sync-${connectionId}`, { connectionId });
  }

  async enqueueReconcile(connectionId: string): Promise<{ queued: boolean }> {
    return this.enqueue(RECONCILE_JOB, `reconcile-${connectionId}`, { connectionId });
  }

  async enqueuePush(bookingId: string): Promise<{ queued: boolean }> {
    return this.enqueue(PUSH_JOB, `push-${bookingId}`, { bookingId });
  }

  async enqueueCancel(bookingId: string): Promise<{ queued: boolean }> {
    return this.enqueue(CANCEL_JOB, `cancel-${bookingId}`, { bookingId });
  }

  async enqueueWebhook(eventId: string): Promise<{ queued: boolean }> {
    return this.enqueue(WEBHOOK_JOB, `webhook-${eventId}`, { eventId });
  }

  private async enqueue(
    name: string,
    jobId: string,
    data: ExternalSyncJob,
  ): Promise<{ queued: boolean }> {
    const previous = await this.queue.getJob(jobId);
    if (previous) {
      const state = await previous.getState();
      // Work still in flight is the dedup case; finished work releases the id.
      if (state !== "completed" && state !== "failed") return { queued: false };
      await previous.remove().catch(() => undefined);
    }

    await this.queue.add(name, data, { jobId });
    return { queued: true };
  }

  // --------------------------------------------------------------- handlers

  private async runSync(connectionId: string) {
    const connection = await this.connections.byId(connectionId);
    if (!connection) throw new UnrecoverableError("CONNECTION_NOT_FOUND");

    try {
      return await this.sync.syncConnection(connection);
    } catch (error) {
      throw this.classify(error);
    }
  }

  private async runReconcile(connectionId: string) {
    const connection = await this.connections.byId(connectionId);
    if (!connection) throw new UnrecoverableError("CONNECTION_NOT_FOUND");

    try {
      return await this.sync.reconcileConnection(connection);
    } catch (error) {
      throw this.classify(error);
    }
  }

  private async runPush(bookingId: string) {
    try {
      return await this.outbound.pushBooking(bookingId);
    } catch (error) {
      throw this.classify(error);
    }
  }

  /**
   * Turns a permanent provider refusal into a job that stops retrying.
   *
   * Rejected credentials and a missing partner programme will be rejected and
   * missing on every attempt; burning the backoff budget on them only delays
   * the jobs that could still succeed (milestone 12 §27).
   */
  private classify(error: unknown): Error {
    if (error instanceof PartnerAccessRequiredError) {
      return new UnrecoverableError(error.code);
    }
    if (error instanceof ProviderError && !error.retryable) {
      return new UnrecoverableError(`${error.code}: ${error.message}`);
    }
    return error as Error;
  }

  // ----------------------------------------------------------------- outbox

  /**
   * Drains this module's own outbox rows onto the queue.
   *
   * The push intent is written in the same transaction that confirms the
   * Booking, so "confirmed but never announced" cannot happen because a
   * process died between the commit and the enqueue — the same reasoning the
   * notification outbox rests on (milestone 12 §14).
   */
  async pumpOutbox(): Promise<{ enqueued: number }> {
    await this.outbox.recoverStale();

    const claimed = await this.outbox.claimPending(BATCH, [...OUTBOX_TYPES]);
    let enqueued = 0;

    for (const event of claimed) {
      try {
        if (event.type === "EXTERNAL_RESERVATION_PUSH") {
          await this.enqueuePush(event.aggregateId);
        } else {
          await this.enqueueCancel(event.aggregateId);
        }

        await this.outbox.markProcessed(event.id);
        enqueued += 1;
      } catch (error) {
        await this.outbox.markFailed(event.id, (error as Error).message);
      }
    }

    return { enqueued };
  }

  // ------------------------------------------------------------------ sweep

  /**
   * The recovery path.
   *
   * Polls connections that have not synced recently, retries pushes that are
   * still pending, and processes provider events whose webhook was accepted but
   * never worked through. A webhook is the fast path and this is what makes
   * losing one survivable (milestone 12 §16).
   */
  async sweep(): Promise<{ synced: number; pushes: number; events: number }> {
    const minutes = Number(this.config.get("EXTERNAL_SYNC_INTERVAL_MINUTES") ?? 15);
    const dueBefore = new Date(Date.now() - minutes * 60 * 1000);

    const due = await this.database.db
      .select({ id: externalInventoryConnections.id })
      .from(externalInventoryConnections)
      .where(
        and(
          inArray(externalInventoryConnections.status, ["CONNECTED", "DEGRADED"]),
          or(
            isNull(externalInventoryConnections.lastSuccessfulSyncAt),
            lt(externalInventoryConnections.lastSuccessfulSyncAt, dueBefore),
          ),
        ),
      )
      .limit(BATCH);

    for (const connection of due) await this.enqueueSync(connection.id);

    // Pushes the queue gave up on, or that were claimed and never finished.
    const pending = await this.outbound.pendingPushes(BATCH);
    const bookingIds = new Set(
      pending.map((row) => row.bookingId).filter((id): id is string => id !== null),
    );
    for (const bookingId of bookingIds) await this.enqueuePush(bookingId);

    // Events accepted at the webhook but not yet applied.
    const unprocessed = await this.database.db
      .select({ id: externalProviderEvents.id })
      .from(externalProviderEvents)
      .where(isNull(externalProviderEvents.processedAt))
      .limit(BATCH);

    for (const event of unprocessed) await this.enqueueWebhook(event.id);

    this.logger.log({
      event: "connectivity.sweep",
      synced: due.length,
      pushes: bookingIds.size,
      events: unprocessed.length,
    });

    return { synced: due.length, pushes: bookingIds.size, events: unprocessed.length };
  }

  async scheduleSweep(): Promise<void> {
    const minutes = Number(this.config.get("EXTERNAL_SYNC_INTERVAL_MINUTES") ?? 15);

    await this.queue.upsertJobScheduler(
      "external-sweep",
      { every: minutes * 60 * 1000 },
      { name: SWEEP_JOB, data: {} },
    );

    // The outbox drain is frequent: it is the path every outbound push takes.
    await this.queue.upsertJobScheduler(
      "external-outbox-pump",
      { every: Number(this.config.get("OUTBOX_POLL_SECONDS") ?? 5) * 1000 },
      { name: OUTBOX_JOB, data: {} },
    );
  }

  /** How many connections are due a poll. Used by the admin dashboard. */
  async dueCount(): Promise<number> {
    const [row] = (await this.database.db.execute(sql`
      SELECT count(*)::int AS total
      FROM external_inventory_connections
      WHERE status IN ('CONNECTED','DEGRADED')
    `)) as unknown as { total: number }[];

    return row?.total ?? 0;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
