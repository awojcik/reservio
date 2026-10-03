import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  externalPropertyMappings,
  type ExternalInventoryConnectionRow,
  type ExternalProvider,
} from "../../../infrastructure/database/schema";
import { ProviderError } from "../domain/provider-errors";
import type { ExternalListing } from "../domain/inventory-provider";
import { ConnectionsService } from "./connections.service";
import { InboundReservationsService } from "./inbound-reservations.service";
import { MappingsService } from "./mappings.service";
import { ProviderRegistry } from "./provider-registry";

export type SyncResult = {
  processed: number;
  failed: number;
  created: number;
  updated: number;
  cancelled: number;
  conflicts: number;
};

const EMPTY: SyncResult = {
  processed: 0,
  failed: 0,
  created: 0,
  updated: 0,
  cancelled: 0,
  conflicts: 0,
};

/**
 * Pulling reservations in from a connected PMS.
 *
 * Two mechanisms, on purpose (milestone 12 §16):
 *
 * ```text
 * webhook  the fast path — usually within seconds
 * polling  the recovery path — for the webhook that never arrived
 * ```
 *
 * Neither is trusted alone. A webhook can be lost, delayed, or delivered out
 * of order; a poll every few minutes is what makes "the calendar is eventually
 * right" true regardless.
 */
@Injectable()
export class InventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly connections: ConnectionsService,
    private readonly mappings: MappingsService,
    private readonly inbound: InboundReservationsService,
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  /** How far ahead reservations are pulled. Months, not years. */
  private get horizonDays(): number {
    return Number(this.config.get("EXTERNAL_SYNC_HORIZON_DAYS") ?? 365);
  }

  /**
   * Everything the provider knows, for every mapped Property.
   *
   * The window is bounded in both directions: a reservation that ended last
   * month cannot change what is bookable tomorrow, and a professional Host's
   * full history is thousands of rows nobody needs.
   */
  async syncConnection(connection: ExternalInventoryConnectionRow): Promise<SyncResult> {
    const provider = this.registry.inventoryProvider(connection.provider as ExternalProvider);
    if (!provider) return { ...EMPTY };

    this.connections.assertUsable(connection);
    const credentials = this.connections.credentialsFor(connection);

    const mapped = await this.mappings.listFor(connection.id);
    const active = mapped.filter((mapping) => mapping.status === "ACTIVE");

    return this.connections.withAttempt(connection, "INBOUND_RESERVATIONS", async () => {
      const result = { ...EMPTY };
      const { from, to } = this.window();

      for (const mapping of active) {
        try {
          const reservations = await provider.listReservations(credentials, {
            externalListingId: mapping.externalPropertyId,
            from,
            to,
          });

          for (const reservation of reservations) {
            const outcome = await this.inbound.apply({
              connectionId: connection.id,
              provider: connection.provider as ExternalProvider,
              propertyId: mapping.propertyId,
              reservation,
            });

            result.processed += 1;
            if (outcome.effect === "CREATED") result.created += 1;
            if (outcome.effect === "UPDATED") result.updated += 1;
            if (outcome.effect === "CANCELLED") result.cancelled += 1;
            if (outcome.conflictsWithBooking) result.conflicts += 1;
          }
        } catch (error) {
          /*
           * One listing failing does not abandon the rest. A Host with twenty
           * Properties should not lose nineteen syncs because one listing was
           * deleted at the provider.
           */
          result.failed += 1;
          this.logger.warn({
            event: "connectivity.listing_sync_failed",
            connectionId: connection.id,
            mappingId: mapping.id,
            code: error instanceof ProviderError ? error.code : "UNEXPECTED",
          });
        }
      }

      return result;
    });
  }

  /**
   * Reconciliation: compares what Rezervio believes against what the provider
   * currently says, and closes the gaps it can explain.
   *
   * The gap that matters is a cancellation whose webhook was lost. Rezervio
   * would go on blocking dates that are free, and nobody would notice until a
   * Guest failed to book them (milestone 12 §16).
   */
  async reconcileConnection(connection: ExternalInventoryConnectionRow): Promise<SyncResult> {
    const provider = this.registry.inventoryProvider(connection.provider as ExternalProvider);
    if (!provider) return { ...EMPTY };

    this.connections.assertUsable(connection);
    const credentials = this.connections.credentialsFor(connection);

    return this.connections.withAttempt(connection, "RECONCILIATION", async () => {
      const result = { ...EMPTY };
      const live = await this.inbound.activeInbound(connection.id);

      for (const mapping of live) {
        try {
          const remote = await provider.getReservation(
            credentials,
            mapping.externalReservationId,
          );

          result.processed += 1;

          /*
           * Gone at the provider, or cancelled there: free the dates. This is
           * the whole point of the pass — the state Rezervio cannot learn any
           * other way once a webhook has been missed.
           */
          if (!remote || remote.status === "CANCELLED") {
            if (await this.inbound.cancelById(mapping.id, mapping.propertyId)) {
              result.cancelled += 1;
            }
            continue;
          }

          // Still live, possibly moved. Re-applying is idempotent.
          const outcome = await this.inbound.apply({
            connectionId: connection.id,
            provider: connection.provider as ExternalProvider,
            propertyId: mapping.propertyId,
            reservation: remote,
          });

          if (outcome.effect === "UPDATED") result.updated += 1;
          if (outcome.conflictsWithBooking) result.conflicts += 1;
        } catch (error) {
          result.failed += 1;
          this.logger.warn({
            event: "connectivity.reconcile_item_failed",
            connectionId: connection.id,
            code: error instanceof ProviderError ? error.code : "UNEXPECTED",
          });
        }
      }

      this.logger.log({
        event: "connectivity.reconciled",
        connectionId: connection.id,
        provider: connection.provider,
        ...result,
      });

      return result;
    });
  }

  /**
   * The Host's listings at the provider, with a suggested match.
   *
   * The suggestion is exact-title-only and always presented for confirmation;
   * see `MappingsService.suggest` for why anything cleverer is worse.
   */
  async discoverListings(
    connection: ExternalInventoryConnectionRow,
  ): Promise<{ listings: ExternalListing[]; alreadyMapped: Set<string> }> {
    const provider = this.registry.inventoryProvider(connection.provider as ExternalProvider);
    if (!provider) return { listings: [], alreadyMapped: new Set() };

    this.connections.assertUsable(connection);
    const credentials = this.connections.credentialsFor(connection);

    const listings = await this.connections.withAttempt(
      connection,
      "PROPERTY_DISCOVERY",
      async () => {
        const found = await provider.listListings(credentials);
        return { processed: found.length, failed: 0, found };
      },
    );

    const mapped = await this.database.db
      .select({ externalPropertyId: externalPropertyMappings.externalPropertyId })
      .from(externalPropertyMappings)
      .where(eq(externalPropertyMappings.connectionId, connection.id));

    return {
      listings: listings.found,
      alreadyMapped: new Set(mapped.map((row) => row.externalPropertyId)),
    };
  }

  /** The date window every pull uses. Half-open, like every range in Rezervio. */
  private window(): { from: string; to: string } {
    const today = new Date();
    const from = new Date(today);
    // A little history, so a reservation that started yesterday and runs into
    // next week is still seen.
    from.setUTCDate(from.getUTCDate() - 7);

    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() + this.horizonDays);

    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
}
