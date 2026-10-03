import { createHash } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  externalProviderEvents,
  externalReservationMappings,
  type ExternalProvider,
} from "../../../infrastructure/database/schema";
import type { ExternalReservation } from "../domain/inventory-provider";
import { ConnectionsService } from "./connections.service";
import { InboundReservationsService } from "./inbound-reservations.service";
import { MappingsService } from "./mappings.service";
import { ProviderRegistry } from "./provider-registry";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const codes = [
    (error as { code?: string }).code,
    ((error as { cause?: { code?: string } }).cause ?? {}).code,
  ];
  return codes.includes(UNIQUE_VIOLATION);
}

export type AcceptedEvent =
  | { accepted: true; eventId: string; duplicate: false }
  | { accepted: true; eventId: string; duplicate: true }
  | { accepted: false; reason: string };

/**
 * Provider events, accepted once and applied once.
 *
 * The same shape and the same reasoning as the payment provider's event table:
 * providers deliver at least once and can replay by hand, so **inserting the
 * row is the permission to process it**. A duplicate loses the unique index and
 * is acknowledged without doing anything (milestone 12 §35).
 *
 * Accept-then-process, rather than process-in-the-request: Hostaway's
 * acknowledgement timeout is twenty seconds, and a sync that has to talk to
 * the provider again can easily exceed that. Returning 200 quickly and doing
 * the work on the queue is what keeps the provider from retrying a delivery we
 * are already handling (milestone 12 §28).
 */
@Injectable()
export class ProviderEventsService {
  private readonly logger = new Logger(ProviderEventsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly connections: ConnectionsService,
    private readonly mappings: MappingsService,
    private readonly inbound: InboundReservationsService,
    private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Records an event, or reports that it has been seen.
   *
   * The payload is hashed rather than stored: the hash is enough to notice
   * that a redelivery differs from the original, without keeping somebody's
   * Guest data in a diagnostics table (milestone 12 §7).
   */
  async accept(input: {
    provider: ExternalProvider;
    connectionId: string | null;
    providerEventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<AcceptedEvent> {
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(input.payload ?? null))
      .digest("hex");

    try {
      const [row] = await this.database.db
        .insert(externalProviderEvents)
        .values({
          provider: input.provider,
          connectionId: input.connectionId,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payloadHash,
        })
        .returning({ id: externalProviderEvents.id });

      this.logger.log({
        event: "connectivity.event_accepted",
        provider: input.provider,
        connectionId: input.connectionId,
        eventType: input.eventType,
      });

      return { accepted: true, eventId: row.id, duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const [existing] = await this.database.db
        .select({ id: externalProviderEvents.id })
        .from(externalProviderEvents)
        .where(eq(externalProviderEvents.providerEventId, input.providerEventId))
        .limit(1);

      this.logger.log({
        event: "connectivity.event_duplicate",
        provider: input.provider,
        eventType: input.eventType,
      });

      return { accepted: true, eventId: existing.id, duplicate: true };
    }
  }

  /**
   * Applies one accepted event.
   *
   * The event carries an id, not a state: the reservation is re-read from the
   * provider rather than trusted from the payload. Hostaway states that events
   * may arrive out of order, so a payload's view of a reservation can already
   * be stale by the time it is processed — asking is the only way to be right
   * (milestone 12 §28).
   */
  async process(eventId: string): Promise<{ applied: boolean; reason?: string }> {
    const [event] = await this.database.db
      .select()
      .from(externalProviderEvents)
      .where(eq(externalProviderEvents.id, eventId))
      .limit(1);

    if (!event) return { applied: false, reason: "EVENT_NOT_FOUND" };
    if (event.processedAt) return { applied: false, reason: "ALREADY_PROCESSED" };
    if (!event.connectionId) {
      await this.markProcessed(eventId);
      return { applied: false, reason: "NO_CONNECTION" };
    }

    const connection = await this.connections.byId(event.connectionId);
    if (!connection) {
      await this.markProcessed(eventId);
      return { applied: false, reason: "CONNECTION_GONE" };
    }

    const provider = this.registry.inventoryProvider(connection.provider as ExternalProvider);
    if (!provider) {
      await this.markProcessed(eventId);
      return { applied: false, reason: "PROVIDER_NOT_PULLABLE" };
    }

    // The reservation id travels in the event type suffix written by the
    // webhook controller: `reservation.created:12345`.
    const externalReservationId = event.eventType.split(":")[1];
    if (!externalReservationId) {
      await this.markProcessed(eventId);
      return { applied: false, reason: "NO_RESERVATION_ID" };
    }

    const credentials = this.connections.credentialsFor(connection);
    const reservation = await provider.getReservation(credentials, externalReservationId);

    if (!reservation) {
      // Gone at the provider between delivery and processing. Free the dates
      // if we were holding any for it.
      await this.cancelIfKnown(connection.id, externalReservationId);
      await this.markProcessed(eventId);
      return { applied: true };
    }

    const mapping = await this.mappings.byExternalId(
      connection.id,
      reservation.externalListingId,
    );

    if (!mapping || mapping.status !== "ACTIVE") {
      // A reservation for a listing this Host has not mapped is not ours to
      // act on. Acknowledged, not applied.
      await this.markProcessed(eventId);
      return { applied: false, reason: "LISTING_NOT_MAPPED" };
    }

    await this.inbound.apply({
      connectionId: connection.id,
      provider: connection.provider as ExternalProvider,
      propertyId: mapping.propertyId,
      reservation,
    });

    await this.markProcessed(eventId);
    return { applied: true };
  }

  /**
   * Applies a reservation the caller already holds, without asking the
   * provider again. Used by the contract tests and by flows where the payload
   * is authoritative by contract.
   */
  async applyKnown(
    connectionId: string,
    provider: ExternalProvider,
    reservation: ExternalReservation,
  ): Promise<{ applied: boolean; reason?: string }> {
    const mapping = await this.mappings.byExternalId(
      connectionId,
      reservation.externalListingId,
    );
    if (!mapping || mapping.status !== "ACTIVE") {
      return { applied: false, reason: "LISTING_NOT_MAPPED" };
    }

    await this.inbound.apply({
      connectionId,
      provider,
      propertyId: mapping.propertyId,
      reservation,
    });

    return { applied: true };
  }

  /**
   * Frees the dates of a reservation that no longer exists at the provider.
   *
   * A hard delete at the provider is indistinguishable from a cancellation
   * from here, and both mean the same thing for the calendar: those nights are
   * available again.
   */
  private async cancelIfKnown(
    connectionId: string,
    externalReservationId: string,
  ): Promise<void> {
    const [mapping] = await this.database.db
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.connectionId, connectionId),
          eq(externalReservationMappings.externalReservationId, externalReservationId),
          eq(externalReservationMappings.direction, "INBOUND"),
        ),
      )
      .limit(1);

    if (mapping) await this.inbound.cancelById(mapping.id, mapping.propertyId);
  }

  private async markProcessed(eventId: string): Promise<void> {
    await this.database.db
      .update(externalProviderEvents)
      .set({ processedAt: new Date() })
      .where(eq(externalProviderEvents.id, eventId));
  }

  /** Events accepted but not yet applied — the operational issue feed. */
  async unprocessed(limit = 100) {
    return this.database.db
      .select()
      .from(externalProviderEvents)
      .where(isNull(externalProviderEvents.processedAt))
      .limit(limit);
  }
}
