import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  externalInventoryConnections,
  externalPropertyMappings,
} from "../../../infrastructure/database/schema";
import { assertValidRange, type DateRange } from "../../../domain/availability";
import { acquirePropertyLock, rangeLiteral } from "../../availability/availability.service";
import type { ChannelChanges } from "../domain/channel-provider";
import type {
  ChannexChangesAckDto,
  ChannexChangesBodyDto,
  ChannexMappingDetailsDto,
} from "../dto/channex.dto";
import { ProviderEventsService } from "./provider-events.service";

/**
 * The Channex side of the channel relationship.
 *
 * Rezervio serves inventory to the channel manager and receives availability
 * back. Two rules govern everything here:
 *
 * 1. **Rezervio's own PostgreSQL stays the deciding authority.** A channel
 *    saying "zero available" blocks the dates; a channel saying "one
 *    available" does *not* unblock dates a Rezervio Booking holds
 *    (milestone 12 §1).
 * 2. **Every write takes the Property advisory lock**, exactly like a Booking,
 *    a hold, an iCal reconciliation or a manual block (milestone 12 §9).
 */
@Injectable()
export class ChannexChangesService {
  private readonly logger = new Logger(ChannexChangesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly events: ProviderEventsService,
  ) {}

  /**
   * The inventory Channex may map against.
   *
   * One room type, one rate plan, `max_persons` from the Property's own
   * capacity. Rezervio has no room types and no allotment, so anything richer
   * would be describing inventory that does not exist (domain language §1).
   */
  async mappingDetails(hotelCode: string): Promise<ChannexMappingDetailsDto> {
    const rows = (await this.database.db.execute(sql`
      SELECT p.id::text AS id, p.title, p.max_guests, p.currency
      FROM external_property_mappings m
      JOIN external_inventory_connections c ON c.id = m.connection_id
      JOIN properties p ON p.id = m.property_id
      WHERE c.provider = 'CHANNEX'
        AND m.status = 'ACTIVE'
        AND m.external_property_id = ${hotelCode}
      ORDER BY p.title
    `)) as unknown as {
      id: string;
      title: string;
      max_guests: number;
      currency: string;
    }[];

    return {
      data: {
        type: "mapping_details",
        attributes: {
          room_types: rows.map((row) => ({
            id: row.id,
            title: row.title,
            rate_plans: [
              {
                id: `${row.id}:standard`,
                title: "Standard",
                sell_mode: "per_room",
                max_persons: row.max_guests,
                currency: row.currency,
                // Pricing is the Host's, set in Rezervio. A channel that could
                // rewrite it would make a Guest's quote depend on a system
                // nobody in Rezervio can see.
                read_only: true,
              },
            ],
          })),
        },
      },
    };
  }

  /**
   * Applies one changes package.
   *
   * The `request_id` is recorded as a provider event first, so a redelivery is
   * acknowledged without being applied twice — the same dedup rule every other
   * provider event follows (milestone 12 §35).
   */
  async applyChanges(body: ChannexChangesBodyDto): Promise<ChannexChangesAckDto> {
    const parsed = parseChanges(body);

    if (!parsed) {
      // A package we cannot read is still acknowledged: making Channex retry a
      // payload we will never understand helps nobody.
      return { success: true, unique_id: "ignored" };
    }

    const connection = await this.connectionFor(parsed.hotelCode);
    if (!connection) return { success: true, unique_id: parsed.requestId };

    const accepted = await this.events.accept({
      provider: "CHANNEX",
      connectionId: connection.id,
      providerEventId: `${connection.id}:${parsed.requestId}`,
      eventType: "changes",
      payload: body,
    });

    if (accepted.accepted && accepted.duplicate) {
      return { success: true, unique_id: parsed.requestId };
    }

    let applied = 0;
    for (const change of blockingRanges(parsed)) {
      if (await this.applyBlock(connection.id, change)) applied += 1;
    }

    this.logger.log({
      event: "connectivity.channex_changes",
      connectionId: connection.id,
      requestId: parsed.requestId,
      applied,
    });

    return { success: true, unique_id: parsed.requestId };
  }

  /**
   * Turns one "unavailable" statement into a block on the mapped Property.
   *
   * Recorded as an inbound reservation mapping keyed by room type and window,
   * so the same statement arriving twice updates one block instead of stacking
   * two — and so a later "available again" can find and remove exactly the
   * block it created.
   */
  private async applyBlock(
    connectionId: string,
    change: { roomTypeId: string; range: DateRange; blocked: boolean },
  ): Promise<boolean> {
    /*
     * `room_type_id` is the Property id: `mappingDetails` publishes one room
     * type per Property using the Property's own id, and Channex quotes it
     * back. Matching on it is therefore an exact lookup, not a heuristic.
     */
    const [mapping] = await this.database.db
      .select()
      .from(externalPropertyMappings)
      .where(
        and(
          eq(externalPropertyMappings.connectionId, connectionId),
          eq(externalPropertyMappings.propertyId, change.roomTypeId),
          eq(externalPropertyMappings.status, "ACTIVE"),
        ),
      )
      .limit(1);

    if (!mapping) return false;

    assertValidRange(change.range);
    const externalId = `channex:${change.roomTypeId}:${change.range.startDate}:${change.range.endDate}`;

    return this.database.db.transaction(async (tx) => {
      await acquirePropertyLock(tx, mapping.propertyId);

      if (!change.blocked) {
        /*
         * The channel says these dates are sellable again. Only the block this
         * channel created is removed — a Rezervio Booking or a Host block over
         * the same nights is untouched, because a channel manager does not get
         * to decide that a paid Stay is not happening (milestone 12 §1).
         */
        const removed = (await tx.execute(sql`
          DELETE FROM availability_blocks ab
          USING external_reservation_mappings m
          WHERE ab.external_reservation_mapping_id = m.id
            AND m.connection_id = ${connectionId}
            AND m.external_reservation_id = ${externalId}
          RETURNING ab.id
        `)) as unknown as { id: string }[];

        await tx.execute(sql`
          UPDATE external_reservation_mappings
          SET status = 'CANCELLED', updated_at = now()
          WHERE connection_id = ${connectionId} AND external_reservation_id = ${externalId}
        `);

        return removed.length > 0;
      }

      const inserted = (await tx.execute(sql`
        INSERT INTO external_reservation_mappings
          (connection_id, provider, external_reservation_id, property_id,
           direction, status, check_in, check_out)
        VALUES (${connectionId}, 'CHANNEX', ${externalId}, ${mapping.propertyId},
                'INBOUND', 'ACTIVE', ${change.range.startDate}, ${change.range.endDate})
        ON CONFLICT (connection_id, external_reservation_id)
        DO UPDATE SET status = 'ACTIVE', updated_at = now()
        RETURNING id
      `)) as unknown as { id: string }[];

      const mappingId = inserted[0].id;

      await tx.execute(sql`
        INSERT INTO availability_blocks
          (property_id, source_type, date_range, external_reservation_mapping_id)
        VALUES (${mapping.propertyId}, 'EXTERNAL_PROVIDER',
                ${rangeLiteral(change.range)}, ${mappingId})
        ON CONFLICT (external_reservation_mapping_id)
        DO UPDATE SET date_range = ${rangeLiteral(change.range)}, updated_at = now()
      `);

      return true;
    });
  }

  private async connectionFor(hotelCode: string) {
    const [row] = await this.database.db
      .select()
      .from(externalInventoryConnections)
      .where(
        and(
          eq(externalInventoryConnections.provider, "CHANNEX"),
          eq(externalInventoryConnections.externalAccountId, hotelCode),
        ),
      )
      .limit(1);

    return row ?? null;
  }
}

/** Reads the contract's nested shape into something with names. */
function parseChanges(body: ChannexChangesBodyDto): ChannelChanges | null {
  const first = body.data?.[0]?.attributes;
  if (!first?.request_id || !first.hotel_code) return null;

  const availability: ChannelChanges["availability"] = [];
  const restrictions: ChannelChanges["restrictions"] = [];

  for (const change of first.changes ?? []) {
    const attributes = change.attributes ?? {};
    const roomTypeId = String(attributes.room_type_id ?? "");
    const dateFrom = String(attributes.date_from ?? "");
    const dateTo = String(attributes.date_to ?? "");
    if (!roomTypeId || !dateFrom || !dateTo) continue;

    if (change.type === "availability_changes") {
      availability.push({
        roomTypeId,
        ratePlanId: (attributes.rate_plan_id as string) ?? null,
        dateFrom,
        dateTo,
        availability: Number(attributes.availability ?? 0),
      });
    }

    if (change.type === "restriction_changes") {
      restrictions.push({
        roomTypeId,
        ratePlanId: (attributes.rate_plan_id as string) ?? null,
        dateFrom,
        dateTo,
        stopSell: typeof attributes.stop_sell === "boolean" ? attributes.stop_sell : null,
      });
    }
  }

  return { requestId: first.request_id, hotelCode: first.hotel_code, availability, restrictions };
}

/**
 * The statements that change whether a Stay may be sold.
 *
 * `date_to` in the contract is inclusive; Rezervio's ranges are half-open, so
 * the end is advanced by a day. Getting this wrong is the classic off-by-one
 * that leaves a Property sellable on its last blocked night.
 */
function blockingRanges(
  changes: ChannelChanges,
): { roomTypeId: string; range: DateRange; blocked: boolean }[] {
  const result: { roomTypeId: string; range: DateRange; blocked: boolean }[] = [];

  for (const entry of changes.availability) {
    result.push({
      roomTypeId: entry.roomTypeId,
      range: { startDate: entry.dateFrom, endDate: nextDay(entry.dateTo) },
      blocked: entry.availability <= 0,
    });
  }

  for (const entry of changes.restrictions) {
    if (entry.stopSell === null) continue;
    result.push({
      roomTypeId: entry.roomTypeId,
      range: { startDate: entry.dateFrom, endDate: nextDay(entry.dateTo) },
      blocked: entry.stopSell,
    });
  }

  return result;
}

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
