import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import {
  availabilityBlocks,
  type AvailabilitySourceType,
} from "../../infrastructure/database/schema";
import {
  assertValidRange,
  mergeRanges,
  subtractRange,
  type DateRange,
} from "../../domain/availability";

export type StoredBlock = DateRange & {
  id: string;
  sourceType: string;
  externalCalendarId: string | null;
  externalEventUid: string | null;
  note: string | null;
};

/**
 * `daterange(?, ?, '[)')` in one place. Every write goes through this so the
 * half-open convention cannot drift between call sites.
 */
export function rangeLiteral(range: DateRange): SQL {
  return sql`daterange(${range.startDate}::date, ${range.endDate}::date, '[)')`;
}

/**
 * Namespace for every Property-scoped advisory lock, so these cannot collide
 * with an advisory lock taken anywhere else in the system.
 */
const PROPERTY_LOCK_NAMESPACE = 4231;

/**
 * Serialises every write that can change a Property's availability
 * (milestone 04 §15).
 *
 * Two concurrent Guests can both read "available" a microsecond apart; without
 * a lock both would then insert a block and the Property would be double
 * booked. `pg_advisory_xact_lock` blocks the second transaction until the
 * first commits or rolls back, and is released automatically at the end of the
 * transaction — there is no lock to leak if the request dies.
 *
 * The key is derived from the Property id, so the lock is per Property: two
 * Guests booking different Properties never wait on each other.
 *
 * Must be called as the first statement inside the transaction, before any
 * availability read whose result is going to be acted on.
 */
export async function acquirePropertyLock(
  tx: Executor,
  propertyId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${PROPERTY_LOCK_NAMESPACE}, hashtext(${propertyId}))`,
  );
}

/**
 * A BookingHold stops blocking the moment it expires, not when the cleanup job
 * gets round to it (milestone 04 §14). Availability therefore never trusts the
 * block row alone — it joins the hold and checks it is still live.
 *
 * HOST_BLOCK and EXTERNAL_CALENDAR rows have no hold and always block.
 */
const LIVE_BLOCK_PREDICATE = sql`(
  ab.booking_hold_id IS NULL
  OR (bh.status = 'ACTIVE' AND bh.expires_at > now())
)`;

/**
 * The canonical overlap predicate (milestone 03 §10). Search, the public
 * availability endpoint, the Host calendar and Booking validation all resolve
 * to this expression — there is deliberately no second definition of "is this
 * Property free?".
 */
export function overlapCondition(alias: string, range: DateRange): SQL {
  return sql`EXISTS (
    SELECT 1 FROM availability_blocks ab
    LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
    WHERE ab.property_id = ${sql.raw(alias)}.id
      AND ab.date_range && ${rangeLiteral(range)}
      AND ${LIVE_BLOCK_PREDICATE}
  )`;
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** available = NOT EXISTS overlapping AvailabilityBlock. Nothing else. */
  async isAvailable(propertyId: string, stay: DateRange): Promise<boolean> {
    assertValidRange(stay);

    return this.isAvailableWithin(this.database.db, propertyId, stay);
  }

  /**
   * The same check, runnable inside a caller's transaction. Booking creation
   * uses this after taking the Property lock, so the answer cannot go stale
   * between the check and the insert (milestone 04 §19).
   */
  async isAvailableWithin(
    executor: Executor,
    propertyId: string,
    stay: DateRange,
  ): Promise<boolean> {
    assertValidRange(stay);

    const rows = (await executor.execute(sql`
      SELECT 1 AS blocked
      FROM availability_blocks ab
      LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
      WHERE ab.property_id = ${propertyId}
        AND ab.date_range && ${rangeLiteral(stay)}
        AND ${LIVE_BLOCK_PREDICATE}
      LIMIT 1
    `)) as unknown as unknown[];

    return rows.length === 0;
  }

  /** Blocks intersecting a window, clipped to nothing — the caller sees real ranges. */
  async getBlocks(
    propertyId: string,
    window: DateRange,
    executor: Executor = this.database.db,
  ): Promise<StoredBlock[]> {
    assertValidRange(window);

    const rows = (await executor.execute(sql`
      SELECT ab.id,
             lower(ab.date_range)::text AS start_date,
             upper(ab.date_range)::text AS end_date,
             ab.source_type,
             ab.external_calendar_id,
             ab.external_event_uid,
             ab.note
      FROM availability_blocks ab
      LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
      WHERE ab.property_id = ${propertyId}
        AND ab.date_range && ${rangeLiteral(window)}
        AND ${LIVE_BLOCK_PREDICATE}
      ORDER BY lower(ab.date_range) ASC
    `)) as unknown as {
      id: string;
      start_date: string;
      end_date: string;
      source_type: string;
      external_calendar_id: string | null;
      external_event_uid: string | null;
      note: string | null;
    }[];

    return rows.map((row) => ({
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      sourceType: row.source_type,
      externalCalendarId: row.external_calendar_id,
      externalEventUid: row.external_event_uid,
      note: row.note,
    }));
  }

  /**
   * Adds a HOST_BLOCK, absorbing every manual block it overlaps or merely
   * touches, so the calendar never accumulates fragments (milestone 03 §13).
   *
   * EXTERNAL_CALENDAR blocks are deliberately left alone: they belong to a
   * snapshot the next sync will rewrite, and merging them into a manual block
   * would make that snapshot unreconcilable.
   */
  async blockDates(
    propertyId: string,
    range: DateRange,
    note: string | null,
  ): Promise<StoredBlock[]> {
    assertValidRange(range);

    await this.database.db.transaction(async (tx) => {
      await acquirePropertyLock(tx, propertyId);

      // `-1 day` on each side catches blocks that merely touch the new range.
      const neighbours = (await tx.execute(sql`
        SELECT id,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date,
               note
        FROM availability_blocks
        WHERE property_id = ${propertyId}
          AND source_type = 'HOST_BLOCK'
          AND date_range && daterange(
                (${range.startDate}::date - 1),
                (${range.endDate}::date + 1),
                '[)'
              )
        FOR UPDATE
      `)) as unknown as {
        id: string;
        start_date: string;
        end_date: string;
        note: string | null;
      }[];

      const pieces: DateRange[] = [
        range,
        ...neighbours.map((row) => ({
          startDate: row.start_date,
          endDate: row.end_date,
        })),
      ];

      const [merged] = mergeRanges(pieces);

      // The incoming note wins; an absorbed block's note is kept only when the
      // new one has none, so merging never silently discards the only note.
      const survivingNote =
        note ?? neighbours.find((row) => row.note !== null)?.note ?? null;

      if (neighbours.length > 0) {
        await tx.execute(sql`
          DELETE FROM availability_blocks
          WHERE id IN (${sql.join(
            neighbours.map((row) => sql`${row.id}::uuid`),
            sql`, `,
          )})
        `);
      }

      await tx.execute(sql`
        INSERT INTO availability_blocks (property_id, source_type, date_range, note)
        VALUES (${propertyId}, 'HOST_BLOCK', ${rangeLiteral(merged)}, ${survivingNote})
      `);
    });

    this.logger.log({
      event: "availability.blocked",
      propertyId,
      startDate: range.startDate,
      endDate: range.endDate,
    });

    return this.getBlocks(propertyId, range);
  }

  /**
   * Removes a slice from the manual blocks of a Property. Depending on where
   * the slice falls this deletes, trims one side, or splits a block in two.
   *
   * EXTERNAL_CALENDAR blocks are never touched: the Host does not own that
   * availability, the source calendar does (milestone 03 §14).
   */
  async unblockDates(propertyId: string, range: DateRange): Promise<StoredBlock[]> {
    assertValidRange(range);

    await this.database.db.transaction(async (tx) => {
      await acquirePropertyLock(tx, propertyId);

      const affected = (await tx.execute(sql`
        SELECT id,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date,
               note
        FROM availability_blocks
        WHERE property_id = ${propertyId}
          AND source_type = 'HOST_BLOCK'
          AND date_range && ${rangeLiteral(range)}
        FOR UPDATE
      `)) as unknown as {
        id: string;
        start_date: string;
        end_date: string;
        note: string | null;
      }[];

      if (affected.length === 0) return;

      await tx.execute(sql`
        DELETE FROM availability_blocks
        WHERE id IN (${sql.join(
          affected.map((row) => sql`${row.id}::uuid`),
          sql`, `,
        )})
      `);

      for (const row of affected) {
        const remainder = subtractRange(
          { startDate: row.start_date, endDate: row.end_date },
          range,
        );

        for (const piece of remainder) {
          await tx.execute(sql`
            INSERT INTO availability_blocks (property_id, source_type, date_range, note)
            VALUES (${propertyId}, 'HOST_BLOCK', ${rangeLiteral(piece)}, ${row.note})
          `);
        }
      }
    });

    this.logger.log({
      event: "availability.unblocked",
      propertyId,
      startDate: range.startDate,
      endDate: range.endDate,
    });

    return this.getBlocks(propertyId, range);
  }

  /**
   * Replaces one calendar's imported blocks with a fresh snapshot, inside a
   * single transaction. Called only after a successful fetch and parse, so a
   * failed sync leaves the previous snapshot standing (milestone 03 §32, §33).
   */
  async reconcileExternalBlocks(
    propertyId: string,
    externalCalendarId: string,
    events: { uid: string; range: DateRange }[],
    horizon: DateRange,
  ): Promise<{ inserted: number; updated: number; deleted: number }> {
    return this.database.db.transaction(async (tx) => {
      await acquirePropertyLock(tx, propertyId);

      const existing = (await tx.execute(sql`
        SELECT id, external_event_uid,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date
        FROM availability_blocks
        WHERE external_calendar_id = ${externalCalendarId}
        FOR UPDATE
      `)) as unknown as {
        id: string;
        external_event_uid: string | null;
        start_date: string;
        end_date: string;
      }[];

      const byUid = new Map(existing.map((row) => [row.external_event_uid, row]));
      const incoming = new Map(events.map((event) => [event.uid, event.range]));

      let inserted = 0;
      let updated = 0;

      for (const [uid, range] of incoming) {
        const current = byUid.get(uid);

        if (!current) {
          await tx.execute(sql`
            INSERT INTO availability_blocks
              (property_id, source_type, date_range, external_calendar_id, external_event_uid)
            VALUES (${propertyId}, 'EXTERNAL_CALENDAR', ${rangeLiteral(range)},
                    ${externalCalendarId}, ${uid})
          `);
          inserted += 1;
          continue;
        }

        if (current.start_date !== range.startDate || current.end_date !== range.endDate) {
          await tx.execute(sql`
            UPDATE availability_blocks
            SET date_range = ${rangeLiteral(range)}, updated_at = now()
            WHERE id = ${current.id}
          `);
          updated += 1;
        }
      }

      // Anything the feed no longer lists — inside the horizon it covers — is
      // gone. Blocks outside the horizon are left alone, because this snapshot
      // says nothing about them.
      const removable = existing.filter(
        (row) =>
          !incoming.has(row.external_event_uid ?? "") &&
          row.start_date < horizon.endDate &&
          horizon.startDate < row.end_date,
      );

      if (removable.length > 0) {
        await tx.execute(sql`
          DELETE FROM availability_blocks
          WHERE id IN (${sql.join(
            removable.map((row) => sql`${row.id}::uuid`),
            sql`, `,
          )})
        `);
      }

      return { inserted, updated, deleted: removable.length };
    });
  }

  /** Drops every block imported by one calendar; manual blocks are untouched. */
  async deleteExternalBlocks(
    externalCalendarId: string,
    executor: Executor = this.database.db,
  ): Promise<void> {
    await executor
      .delete(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.externalCalendarId, externalCalendarId),
          eq(
            availabilityBlocks.sourceType,
            "EXTERNAL_CALENDAR" satisfies AvailabilitySourceType,
          ),
        ),
      );
  }
}
