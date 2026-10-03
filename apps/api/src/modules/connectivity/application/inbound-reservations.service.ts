import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database, Executor } from "../../../infrastructure/database/connection";
import {
  externalReservationMappings,
  type ExternalProvider,
  type ExternalReservationMappingRow,
} from "../../../infrastructure/database/schema";
import { assertValidRange, type DateRange } from "../../../domain/availability";
import { acquirePropertyLock, rangeLiteral } from "../../availability/availability.service";
import type { ExternalReservation } from "../domain/inventory-provider";

export type InboundOutcome = {
  /** What the reservation did to Rezervio's state, once. */
  effect: "CREATED" | "UPDATED" | "CANCELLED" | "UNCHANGED";
  mappingId: string;
  /**
   * True when the external reservation covers dates a Rezervio Booking already
   * holds. Not an error to record — a fact to surface (milestone 12 §29).
   */
  conflictsWithBooking: boolean;
};

/**
 * External reservations becoming Rezervio availability.
 *
 * The single most important property of this file: **every write takes the
 * same Property advisory lock that Booking creation, hold expiry, iCal
 * reconciliation and manual blocks take**. An external reservation arriving
 * while a Guest is paying must queue behind that transaction, not race it
 * (milestone 12 §9, §29).
 *
 * The second most important: a reservation is identified by
 * `(connection, external reservation id)`, and its block by the mapping row.
 * Both are unique in the database, so a webhook delivered three times and a
 * polling pass that overlaps it converge on exactly one block
 * (milestone 12 §35).
 *
 * A projection, not a Booking. An external reservation has no Rezervio Guest,
 * no price we set and no payment we took; manufacturing a Booking for it would
 * invent all three (milestone 12 §13).
 */
@Injectable()
export class InboundReservationsService {
  private readonly logger = new Logger(InboundReservationsService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Applies one external reservation, whatever state it arrives in.
   *
   * Idempotent by construction: the whole thing runs inside one transaction
   * under the Property lock, and both the mapping and the block are keyed so
   * that a second application updates rather than inserts.
   */
  async apply(input: {
    connectionId: string;
    provider: ExternalProvider;
    propertyId: string;
    reservation: ExternalReservation;
  }): Promise<InboundOutcome> {
    const { connectionId, provider, propertyId, reservation } = input;

    const cancelled = reservation.status === "CANCELLED";
    const stay: DateRange = {
      startDate: reservation.checkIn,
      endDate: reservation.checkOut,
    };
    if (!cancelled) assertValidRange(stay);

    const outcome = await this.database.db.transaction(async (tx) => {
      // First statement in the transaction. Everything read below is read
      // under the lock, and no other availability write can interleave.
      await acquirePropertyLock(tx, propertyId);

      const existing = await this.claimMapping(tx, {
        connectionId,
        provider,
        propertyId,
        reservation,
      });

      if (cancelled) {
        if (existing.row.status === "CANCELLED") {
          return { effect: "UNCHANGED" as const, mappingId: existing.row.id, conflict: false };
        }

        await tx
          .update(externalReservationMappings)
          .set({ status: "CANCELLED", updatedAt: new Date() })
          .where(eq(externalReservationMappings.id, existing.row.id));

        // The dates are free again. Deleting the block rather than trimming it
        // is right: the block exists only because this reservation does.
        await tx.execute(sql`
          DELETE FROM availability_blocks
          WHERE external_reservation_mapping_id = ${existing.row.id}
        `);

        return { effect: "CANCELLED" as const, mappingId: existing.row.id, conflict: false };
      }

      /*
       * Does a Rezervio Booking already hold these dates?
       *
       * If so this is a genuine double sale — the same nights sold here and
       * there — and no amount of blocking fixes it. The block is still written
       * (the dates really are taken) and the conflict is surfaced for a human,
       * because silently overwriting either side would hide it.
       */
      const conflict = await this.overlapsRezervioBooking(tx, propertyId, stay);

      const [block] = (await tx.execute(sql`
        SELECT id,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date
        FROM availability_blocks
        WHERE external_reservation_mapping_id = ${existing.row.id}
        FOR UPDATE
      `)) as unknown as { id: string; start_date: string; end_date: string }[];

      if (!block) {
        await tx.execute(sql`
          INSERT INTO availability_blocks
            (property_id, source_type, date_range, external_reservation_mapping_id)
          VALUES (${propertyId}, 'EXTERNAL_PROVIDER', ${rangeLiteral(stay)}, ${existing.row.id})
        `);

        await this.storeStay(tx, existing.row.id, stay, reservation);
        return {
          effect: existing.created ? ("CREATED" as const) : ("UPDATED" as const),
          mappingId: existing.row.id,
          conflict,
        };
      }

      if (block.start_date === stay.startDate && block.end_date === stay.endDate) {
        // The same reservation, unchanged. This is the duplicate-delivery path
        // and it must do nothing at all.
        await this.storeStay(tx, existing.row.id, stay, reservation);
        return { effect: "UNCHANGED" as const, mappingId: existing.row.id, conflict };
      }

      await tx.execute(sql`
        UPDATE availability_blocks
        SET date_range = ${rangeLiteral(stay)}, updated_at = now()
        WHERE id = ${block.id}
      `);

      await this.storeStay(tx, existing.row.id, stay, reservation);
      return { effect: "UPDATED" as const, mappingId: existing.row.id, conflict };
    });

    this.logger.log({
      event: "connectivity.inbound_reservation",
      connectionId,
      provider,
      propertyId,
      effect: outcome.effect,
      // The external id is an identifier, not a secret. The Guest name is not
      // logged at all.
      externalReservationId: reservation.externalId,
      conflictsWithBooking: outcome.conflict,
    });

    return {
      effect: outcome.effect,
      mappingId: outcome.mappingId,
      conflictsWithBooking: outcome.conflict,
    };
  }

  /**
   * Finds or creates the mapping row, inside the caller's transaction.
   *
   * `ON CONFLICT DO UPDATE` rather than select-then-insert: two deliveries of
   * the same reservation can reach this line concurrently on different
   * Properties' locks, and only the unique index can settle it.
   */
  private async claimMapping(
    tx: Executor,
    input: {
      connectionId: string;
      provider: ExternalProvider;
      propertyId: string;
      reservation: ExternalReservation;
    },
  ): Promise<{ row: ExternalReservationMappingRow; created: boolean }> {
    const [before] = await tx
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.connectionId, input.connectionId),
          eq(
            externalReservationMappings.externalReservationId,
            input.reservation.externalId,
          ),
        ),
      )
      .limit(1);

    if (before) return { row: before, created: false };

    const [row] = await tx
      .insert(externalReservationMappings)
      .values({
        connectionId: input.connectionId,
        provider: input.provider,
        externalReservationId: input.reservation.externalId,
        propertyId: input.propertyId,
        direction: "INBOUND",
        status: input.reservation.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
      })
      .onConflictDoUpdate({
        target: [
          externalReservationMappings.connectionId,
          externalReservationMappings.externalReservationId,
        ],
        set: { updatedAt: new Date() },
      })
      .returning();

    return { row, created: true };
  }

  /** Keeps the mapping's own copy of the dates in step with the block. */
  private async storeStay(
    tx: Executor,
    mappingId: string,
    stay: DateRange,
    reservation: ExternalReservation,
  ): Promise<void> {
    await tx
      .update(externalReservationMappings)
      .set({
        status: reservation.status === "PENDING" ? "PENDING" : "ACTIVE",
        checkIn: stay.startDate,
        checkOut: stay.endDate,
        updatedAt: new Date(),
      })
      .where(eq(externalReservationMappings.id, mappingId));
  }

  /**
   * A Rezervio Booking that already holds these nights.
   *
   * Confirmed Stays *and* live holds. A hold is a Guest partway through paying
   * for exactly these dates; if an external reservation lands on top of one,
   * the two systems have sold the same nights and somebody has to know. Waiting
   * to see whether the payment lands would mean discovering the clash at the
   * worst possible moment.
   *
   * The lock makes the other order safe on its own: an external reservation
   * that commits first is simply an unavailable Property, and hold creation
   * fails with `PROPERTY_NOT_AVAILABLE` like any other clash
   * (milestone 12 §29).
   */
  private async overlapsRezervioBooking(
    tx: Executor,
    propertyId: string,
    stay: DateRange,
  ): Promise<boolean> {
    const rows = (await tx.execute(sql`
      SELECT 1
      FROM availability_blocks ab
      LEFT JOIN bookings b ON b.id = ab.booking_id
      LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
      WHERE ab.property_id = ${propertyId}
        AND ab.date_range && ${rangeLiteral(stay)}
        AND (
          (ab.source_type = 'BOOKING' AND b.status IN ('CONFIRMED','COMPLETED'))
          OR (ab.source_type = 'BOOKING_HOLD' AND bh.status = 'ACTIVE' AND bh.expires_at > now())
        )
      LIMIT 1
    `)) as unknown as unknown[];

    return rows.length > 0;
  }

  /** Active inbound reservations for one connection, for reconciliation. */
  async activeInbound(connectionId: string): Promise<ExternalReservationMappingRow[]> {
    return this.database.db
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.connectionId, connectionId),
          eq(externalReservationMappings.direction, "INBOUND"),
          eq(externalReservationMappings.status, "ACTIVE"),
        ),
      );
  }

  /**
   * Marks an inbound reservation gone and frees its dates.
   *
   * Used by reconciliation for a reservation the provider no longer lists —
   * a cancellation whose webhook never arrived.
   */
  async cancelById(mappingId: string, propertyId: string): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      await acquirePropertyLock(tx, propertyId);

      const [row] = await tx
        .update(externalReservationMappings)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(externalReservationMappings.id, mappingId),
            eq(externalReservationMappings.status, "ACTIVE"),
          ),
        )
        .returning({ id: externalReservationMappings.id });

      if (!row) return false;

      await tx.execute(sql`
        DELETE FROM availability_blocks WHERE external_reservation_mapping_id = ${mappingId}
      `);

      return true;
    });
  }
}
