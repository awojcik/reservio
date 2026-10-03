import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { toIsoOrNull } from "../../common/pg-values";
import { assertValidRange } from "../../domain/availability";
import type {
  HostAllCalendarDto,
  HostAllCalendarEventDto,
  HostAllCalendarQueryDto,
} from "./dto/host-calendar.dto";

/** One request must not ask for a decade of calendar (milestone 07 §20). */
const MAX_RANGE_DAYS = 366;

const PROVIDER_LABELS: Record<string, string> = {
  BOOKING: "Booking.com",
  AIRBNB: "Airbnb",
  VRBO: "Vrbo",
  PMS: "System PMS",
  OTHER: "Kalendarz zewnętrzny",
};

/** Human labels, never a bare enum on screen (milestone 07 §15). */
const TYPE_LABELS: Record<string, string> = {
  BOOKING: "Rezerwacja",
  BOOKING_HOLD: "Tymczasowo zablokowane",
  HOST_BLOCK: "Ręczna blokada",
  EXTERNAL_CALENDAR: "Niedostępne",
  MAINTENANCE: "Prace serwisowe",
};

type EventRow = {
  id: string;
  property_id: string;
  source_type: string;
  start_date: string;
  end_date: string;
  note: string | null;
  provider: string | null;
  calendar_name: string | null;
  booking_reference: string | null;
  guest_name: string | null;
  hold_expires_at: string | null;
};

/**
 * The calendar across every Property a Host owns.
 *
 * Two queries in total — one for the Properties, one for every event in the
 * window — rather than one per Property or per day (milestone 07 §21).
 */
@Injectable()
export class HostCalendarService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async calendar(hostId: string, query: HostAllCalendarQueryDto): Promise<HostAllCalendarDto> {
    assertValidRange({ startDate: query.from, endDate: query.to });

    const days =
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) /
      86_400_000;
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Zakres nie może przekraczać ${MAX_RANGE_DAYS} dni.`,
      );
    }

    const properties = (await this.database.db.execute(sql`
      SELECT id, title, status, time_zone
      FROM properties
      WHERE host_id = ${hostId}
        AND status <> 'ARCHIVED'
        ${query.propertyId ? sql`AND id = ${query.propertyId}` : sql``}
      ORDER BY title ASC
    `)) as unknown as {
      id: string;
      title: string;
      status: string;
      time_zone: string;
    }[];

    if (properties.length === 0) {
      return { from: query.from, to: query.to, properties: [] };
    }

    const propertyIds = properties.map((property) => property.id);

    /**
     * Everything blocking the window, in one pass. The joins carry the label
     * data along, so nothing has to be looked up per event afterwards.
     *
     * The hold predicate is the same one Availability uses: an expired hold
     * stops blocking immediately and must not appear as a live event
     * (milestone 07 §13).
     */
    const rows = (await this.database.db.execute(sql`
      SELECT ab.id,
             ab.property_id,
             ab.source_type,
             lower(ab.date_range)::text AS start_date,
             upper(ab.date_range)::text AS end_date,
             ab.note,
             ec.provider,
             ec.name AS calendar_name,
             bk.public_reference AS booking_reference,
             bk.guest_name,
             bh.expires_at AS hold_expires_at
      FROM availability_blocks ab
      LEFT JOIN external_calendars ec ON ec.id = ab.external_calendar_id
      LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
      LEFT JOIN bookings bk ON bk.id = bh.booking_id
      WHERE ab.property_id IN (${sql.join(
        propertyIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND ab.date_range && daterange(${query.from}::date, ${query.to}::date, '[)')
        AND (
          ab.booking_hold_id IS NULL
          OR (bh.status = 'ACTIVE' AND bh.expires_at > now())
        )
      ORDER BY ab.property_id, lower(ab.date_range) ASC
      LIMIT ${query.limit ?? 500}
    `)) as unknown as EventRow[];

    const byProperty = new Map<string, HostAllCalendarEventDto[]>();
    for (const row of rows) {
      const events = byProperty.get(row.property_id) ?? [];
      events.push(toEvent(row));
      byProperty.set(row.property_id, events);
    }

    return {
      from: query.from,
      to: query.to,
      properties: properties.map((property) => ({
        id: property.id,
        title: property.title,
        status: property.status,
        timeZone: property.time_zone,
        events: byProperty.get(property.id) ?? [],
      })),
    };
  }
}

function toEvent(row: EventRow): HostAllCalendarEventDto {
  const external = row.source_type === "EXTERNAL_CALENDAR";
  const provider = row.provider ? (PROVIDER_LABELS[row.provider] ?? row.provider) : null;

  return {
    id: row.id,
    type: row.source_type,
    startDate: row.start_date,
    endDate: row.end_date,
    label: external
      ? `${TYPE_LABELS.EXTERNAL_CALENDAR} — ${provider ?? "iCal"}`
      : (TYPE_LABELS[row.source_type] ?? row.source_type),
    sourceLabel: external ? (row.calendar_name ?? provider) : (row.note ?? null),
    bookingReference: external ? null : row.booking_reference,
    /**
     * Never for an external feed. Its SUMMARY belongs to another platform's
     * guest and is not ours to show (milestone 07 §16).
     */
    guestName: external ? null : row.guest_name,
    expiresAt: toIsoOrNull(row.hold_expires_at),
  };
}
