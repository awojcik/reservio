import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  bookings,
  externalReservationMappings,
  type ExternalProvider,
  type ExternalReservationMappingRow,
} from "../../../infrastructure/database/schema";
import { ProviderError } from "../domain/provider-errors";
import type { InventoryProvider } from "../domain/inventory-provider";
import { ConnectionsService } from "./connections.service";
import { ProviderRegistry } from "./provider-registry";

export type PushOutcome =
  | { pushed: true; externalReservationId: string; mappingId: string }
  | { pushed: false; reason: string; mappingId?: string };

/** How many times a push may fail before it stops being retried automatically. */
const MAX_PUSH_ATTEMPTS = 8;

/**
 * Rezervio Bookings going out to connected systems.
 *
 * The rule this file exists to enforce: **a retried push must never create a
 * second reservation at the provider**. The mechanism is the same one that
 * stops a Host being paid twice — claim a row, then call.
 *
 * ```text
 * claim  partial unique index on (connection, booking) where direction=OUTBOUND
 *        and status <> FAILED  → only one worker gets PENDING
 * call   the provider, outside the transaction
 * record what it said, in a short transaction of its own
 * ```
 *
 * The claim is a database guarantee, not an ordering assumption: two workers
 * that reach it in the same millisecond produce one row and one provider call
 * (milestone 12 §14, §35).
 *
 * And the rule that governs failure: a provider that will not accept the push
 * does **not** undo the Booking. The Guest paid, the Stay is confirmed, and a
 * channel manager having a bad afternoon is not a reason to cancel it. The
 * failure becomes an operational issue and a retry (milestone 12 §30).
 */
@Injectable()
export class OutboundReservationsService {
  private readonly logger = new Logger(OutboundReservationsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly connections: ConnectionsService,
    private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Pushes one confirmed Booking to every system its Property is mapped into.
   *
   * A Property can be connected to both a PMS and a channel manager, so this
   * fans out; each destination succeeds or fails on its own.
   */
  async pushBooking(bookingId: string): Promise<PushOutcome[]> {
    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) return [{ pushed: false, reason: "BOOKING_NOT_FOUND" }];

    /*
     * Only a Stay that is actually happening is announced. A Booking that was
     * cancelled between the outbox row and this job must not be pushed —
     * otherwise the retry would block dates nobody is staying on.
     */
    if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
      return [{ pushed: false, reason: `BOOKING_${booking.status}` }];
    }

    const targets = await this.destinationsFor(booking.propertyId);
    if (targets.length === 0) return [{ pushed: false, reason: "NOT_MAPPED" }];

    const outcomes: PushOutcome[] = [];
    for (const target of targets) {
      outcomes.push(await this.pushTo(target, booking));
    }

    return outcomes;
  }

  private async pushTo(
    target: { connectionId: string; externalPropertyId: string },
    booking: typeof bookings.$inferSelect,
  ): Promise<PushOutcome> {
    const connection = await this.connections.byId(target.connectionId);
    if (!connection) return { pushed: false, reason: "CONNECTION_GONE" };

    const provider = this.registry.inventoryProvider(
      connection.provider as ExternalProvider,
    );
    if (!provider) {
      /*
       * A channel-shaped provider is not pushed to from here: Rezervio does not
       * hold its credentials as a client, and its booking delivery is governed
       * by a contract this service does not speak (milestone 12 §17).
       */
      return { pushed: false, reason: "PROVIDER_NOT_PUSHABLE" };
    }

    if (connection.status !== "CONNECTED" && connection.status !== "DEGRADED") {
      return { pushed: false, reason: `CONNECTION_${connection.status}` };
    }

    const claim = await this.claim(
      connection.id,
      connection.provider as ExternalProvider,
      booking,
    );
    if (claim.kind === "already") {
      // Someone already did this. Not an error — the point of the claim.
      return {
        pushed: true,
        externalReservationId: claim.row.externalReservationId,
        mappingId: claim.row.id,
      };
    }
    if (claim.kind === "in_progress") {
      return { pushed: false, reason: "IN_PROGRESS", mappingId: claim.row.id };
    }
    if (claim.kind === "exhausted") {
      return { pushed: false, reason: "ATTEMPTS_EXHAUSTED", mappingId: claim.row.id };
    }

    try {
      const result = await this.callProvider(provider, connection.id, {
        externalListingId: target.externalPropertyId,
        booking,
      });

      await this.database.db
        .update(externalReservationMappings)
        .set({
          externalReservationId: result.externalReservationId,
          status: "ACTIVE",
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(externalReservationMappings.id, claim.row.id));

      this.logger.log({
        event: "connectivity.outbound_pushed",
        connectionId: connection.id,
        provider: connection.provider,
        bookingId: booking.id,
        bookingReference: booking.publicReference,
      });

      return {
        pushed: true,
        externalReservationId: result.externalReservationId,
        mappingId: claim.row.id,
      };
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "UNEXPECTED";
      const retryable = error instanceof ProviderError ? error.retryable : true;

      /*
       * Back to PENDING when another attempt could plausibly work, FAILED when
       * it could not. FAILED releases the partial unique index, so a Host who
       * fixes their credentials can be pushed again — the index covers live
       * rows, not the history (milestone 12 §14).
       */
      await this.database.db
        .update(externalReservationMappings)
        .set({
          status: retryable ? "PENDING" : "FAILED",
          lastErrorCode: code,
          updatedAt: new Date(),
        })
        .where(eq(externalReservationMappings.id, claim.row.id));

      this.logger.warn({
        event: "connectivity.outbound_failed",
        connectionId: connection.id,
        bookingId: booking.id,
        code,
        retryable,
      });

      // Rethrown so the queue retries with backoff. The Booking is untouched.
      throw error;
    }
  }

  private async callProvider(
    provider: InventoryProvider,
    connectionId: string,
    input: { externalListingId: string; booking: typeof bookings.$inferSelect },
  ): Promise<{ externalReservationId: string }> {
    const full = (await this.connections.byId(connectionId))!;
    const credentials = this.connections.credentialsFor(full);

    return this.connections.withAttempt(full, "OUTBOUND_PUSH", async () => {
      const result = await provider.createReservation(credentials, {
        externalListingId: input.externalListingId,
        bookingId: input.booking.id,
        bookingReference: input.booking.publicReference,
        checkIn: input.booking.checkIn,
        checkOut: input.booking.checkOut,
        guestName: input.booking.guestName,
        adults: input.booking.adults,
        children: input.booking.children,
        totalAmountMinor: input.booking.totalAmountMinor,
        currency: input.booking.currency,
      });

      return { processed: 1, failed: 0, ...result };
    });
  }

  /**
   * Takes the right to push this Booking to this connection, or reports who
   * already has it.
   *
   * The placeholder external id is what makes the row insertable before the
   * provider has given us a real one; it is replaced on success and never
   * escapes to the provider.
   */
  private async claim(
    connectionId: string,
    provider: ExternalProvider,
    booking: typeof bookings.$inferSelect,
  ): Promise<
    | { kind: "claimed"; row: ExternalReservationMappingRow }
    | { kind: "already"; row: ExternalReservationMappingRow }
    | { kind: "in_progress"; row: ExternalReservationMappingRow }
    | { kind: "exhausted"; row: ExternalReservationMappingRow }
  > {
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(externalReservationMappings)
        .where(
          and(
            eq(externalReservationMappings.connectionId, connectionId),
            eq(externalReservationMappings.bookingId, booking.id),
            eq(externalReservationMappings.direction, "OUTBOUND"),
          ),
        )
        .limit(1)
        .for("update");

      if (existing?.status === "ACTIVE") return { kind: "already" as const, row: existing };
      if (existing?.status === "CANCELLED") return { kind: "already" as const, row: existing };

      if (existing) {
        if (existing.attemptCount >= MAX_PUSH_ATTEMPTS) {
          return { kind: "exhausted" as const, row: existing };
        }

        const [row] = await tx
          .update(externalReservationMappings)
          .set({
            status: "PENDING",
            attemptCount: existing.attemptCount + 1,
            updatedAt: new Date(),
          })
          .where(eq(externalReservationMappings.id, existing.id))
          .returning();

        return { kind: "claimed" as const, row };
      }

      const [row] = await tx
        .insert(externalReservationMappings)
        .values({
          connectionId,
          provider,
          // Replaced by the provider's own id the moment it answers. Prefixed
          // so a row still holding it is obviously un-pushed.
          externalReservationId: `pending:${booking.id}`,
          bookingId: booking.id,
          propertyId: booking.propertyId,
          direction: "OUTBOUND",
          status: "PENDING",
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          attemptCount: 1,
        })
        .returning();

      return { kind: "claimed" as const, row };
    });
  }

  /**
   * Tells connected systems that a pushed Booking is off.
   *
   * Only rows that were actually pushed are cancelled; the mapping is kept,
   * because "this Booking went to that provider and was then cancelled" is
   * part of the history somebody will need (milestone 12 §15).
   */
  async cancelBooking(bookingId: string): Promise<{ cancelled: number; failed: number }> {
    const rows = await this.database.db
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.bookingId, bookingId),
          eq(externalReservationMappings.direction, "OUTBOUND"),
          inArray(externalReservationMappings.status, ["ACTIVE", "PENDING"]),
        ),
      );

    let cancelled = 0;
    let failed = 0;

    for (const row of rows) {
      const connection = await this.connections.byId(row.connectionId);
      const provider =
        connection && this.registry.inventoryProvider(connection.provider as ExternalProvider);

      // Never pushed: there is nothing at the provider to cancel, so the
      // mapping simply stops being a pending push.
      if (row.externalReservationId.startsWith("pending:")) {
        await this.markCancelled(row.id);
        cancelled += 1;
        continue;
      }

      if (!connection || !provider) {
        failed += 1;
        continue;
      }

      try {
        await this.connections.withAttempt(connection, "OUTBOUND_CANCEL", async () => {
          await provider.cancelReservation(
            this.connections.credentialsFor(connection),
            row.externalReservationId,
          );
          return { processed: 1, failed: 0 };
        });

        await this.markCancelled(row.id);
        cancelled += 1;

        this.logger.log({
          event: "connectivity.outbound_cancelled",
          connectionId: connection.id,
          bookingId,
        });
      } catch (error) {
        failed += 1;
        await this.database.db
          .update(externalReservationMappings)
          .set({
            lastErrorCode: error instanceof ProviderError ? error.code : "UNEXPECTED",
            updatedAt: new Date(),
          })
          .where(eq(externalReservationMappings.id, row.id));
      }
    }

    return { cancelled, failed };
  }

  private async markCancelled(mappingId: string): Promise<void> {
    await this.database.db
      .update(externalReservationMappings)
      .set({ status: "CANCELLED", lastErrorCode: null, updatedAt: new Date() })
      .where(eq(externalReservationMappings.id, mappingId));
  }

  /** Active connections this Property is mapped into. */
  private async destinationsFor(
    propertyId: string,
  ): Promise<{ connectionId: string; externalPropertyId: string }[]> {
    const rows = (await this.database.db.execute(sql`
      SELECT m.connection_id, m.external_property_id
      FROM external_property_mappings m
      JOIN external_inventory_connections c ON c.id = m.connection_id
      WHERE m.property_id = ${propertyId}
        AND m.status = 'ACTIVE'
        AND c.status IN ('CONNECTED','DEGRADED')
    `)) as unknown as { connection_id: string; external_property_id: string }[];

    return rows.map((row) => ({
      connectionId: row.connection_id,
      externalPropertyId: row.external_property_id,
    }));
  }

  /** Outbound pushes still waiting or failed — the operational issue feed. */
  async pendingPushes(limit = 100): Promise<ExternalReservationMappingRow[]> {
    return this.database.db
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.direction, "OUTBOUND"),
          inArray(externalReservationMappings.status, ["PENDING", "FAILED"]),
        ),
      )
      .limit(limit);
  }
}
