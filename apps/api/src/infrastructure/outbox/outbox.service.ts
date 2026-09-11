import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { DATABASE } from "../database/database.module";
import type { Database, Executor } from "../database/connection";
import { outboxEvents } from "../database/schema";

export type OutboxRecord = {
  type: string;
  aggregateType: string;
  aggregateId: string;
  /** Ids only — never Guest details (milestone 05 §46). */
  payload: Record<string, string>;
};

export type ClaimedOutboxEvent = {
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, string>;
};

/**
 * Transactional outbox.
 *
 * The point is the gap between "the Booking changed" and "the email was
 * queued". Calling `queue.add()` after COMMIT loses the notification if the
 * process dies in between; writing the intent inside the same transaction
 * cannot (milestone 05 §44).
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Must be called with the caller's transaction, never the pool. */
  async record(executor: Executor, event: OutboxRecord): Promise<void> {
    await executor.insert(outboxEvents).values({
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payloadJson: JSON.stringify(event.payload),
    });
  }

  /**
   * Claims a batch for processing.
   *
   * `FOR UPDATE SKIP LOCKED` lets several processors run without handing the
   * same row to two of them, and without one slow row blocking the queue.
   *
   * `types` scopes a processor to the events it knows how to dispatch. Without
   * it, two pumps over one table would steal each other's rows and each would
   * mark the other's work processed without doing it (milestone 12 §27).
   */
  async claimPending(limit = 50, types?: string[]): Promise<ClaimedOutboxEvent[]> {
    return this.database.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id, type, aggregate_id, payload_json
        FROM outbox_events
        WHERE status = 'PENDING'
          ${
            types && types.length > 0
              ? sql`AND type IN (${sql.join(
                  types.map((type) => sql`${type}`),
                  sql`, `,
                )})`
              : sql``
          }
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `)) as unknown as {
        id: string;
        type: string;
        aggregate_id: string;
        payload_json: string;
      }[];

      if (rows.length === 0) return [];

      await tx.execute(sql`
        UPDATE outbox_events
        SET status = 'PROCESSING', attempt_count = attempt_count + 1
        WHERE id IN (${sql.join(
          rows.map((row) => sql`${row.id}::uuid`),
          sql`, `,
        )})
      `);

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        aggregateId: row.aggregate_id,
        payload: JSON.parse(row.payload_json) as Record<string, string>,
      }));
    });
  }

  async markProcessed(id: string): Promise<void> {
    await this.database.db
      .update(outboxEvents)
      .set({ status: "PROCESSED", processedAt: new Date() })
      .where(eq(outboxEvents.id, id));
  }

  /** Back to PENDING so the next pass retries it. */
  async markFailed(id: string, error: string): Promise<void> {
    await this.database.db
      .update(outboxEvents)
      .set({ status: "PENDING", lastError: error.slice(0, 500) })
      .where(eq(outboxEvents.id, id));

    this.logger.warn({ event: "outbox.enqueue_failed", outboxId: id });
  }

  /**
   * Rescues rows stuck in PROCESSING because the process died mid-flight.
   * Without this they would never be retried.
   */
  async recoverStale(olderThanMs = 5 * 60 * 1000): Promise<number> {
    const rows = (await this.database.db.execute(sql`
      UPDATE outbox_events
      SET status = 'PENDING'
      WHERE status = 'PROCESSING'
        AND created_at < now() - ${sql.raw(`interval '${Math.round(olderThanMs / 1000)} seconds'`)}
      RETURNING id
    `)) as unknown as { id: string }[];

    return rows.length;
  }
}
