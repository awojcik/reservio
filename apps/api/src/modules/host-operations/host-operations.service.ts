import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { toDate, toDateOrNull, toIso, toIsoOrNull } from "../../common/pg-values";
import { today } from "../../domain/availability";
import { evaluatePublishReadiness } from "../../domain/publish-readiness";
import type {
  AttentionItemDto,
  CalendarSyncHealthDto,
  HostDashboardDto,
  OperationalBookingDto,
  PropertiesOverviewDto,
} from "./dto/dashboard.dto";

/** How soon a pending request counts as urgent. */
const EXPIRING_SOON_HOURS = 6;
/** How many upcoming stays the dashboard shows. One limit, used everywhere. */
const UPCOMING_LIMIT = 10;

type BookingRowRaw = {
  id: string;
  reference: string;
  status: string;
  property_id: string;
  property_title: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  total_amount_minor: number;
  currency: string;
  host_response_deadline_at: string | null;
};

const SEVERITY_ORDER: Record<string, number> = { ACTION: 0, WARNING: 1, INFO: 2 };

const DATE_LABEL = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

function stayLabel(checkIn: string, checkOut: string): string {
  return `${DATE_LABEL.format(new Date(`${checkIn}T00:00:00Z`))} – ${DATE_LABEL.format(
    new Date(`${checkOut}T00:00:00Z`),
  )}`;
}

/**
 * Read-side projection behind `/host`.
 *
 * Deliberately a handful of batch queries rather than one per Property or per
 * Booking: a Host with twenty listings would otherwise pay for sixty round
 * trips to render one screen (milestone 07 §21).
 */
@Injectable()
export class HostOperationsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly config: ConfigService,
  ) {}

  private get staleAfterMinutes(): number {
    // Same threshold the calendar sync itself uses, times a grace factor —
    // one definition of "stale", not a second one in the frontend (§11).
    return Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15) * 4;
  }

  async dashboard(hostId: string): Promise<HostDashboardDto> {
    // A Host's Properties normally share a timezone; the first one is a sane
    // basis for "today" and avoids a per-Property date calculation.
    const timeZone = await this.hostTimeZone(hostId);
    const now = today(timeZone);

    const [
      arrivals,
      departures,
      pendingRequests,
      upcomingStays,
      properties,
      calendarSync,
      attention,
    ] = await Promise.all([
      this.bookingsOn(hostId, "check_in", now),
      this.bookingsOn(hostId, "check_out", now),
      this.pendingRequests(hostId),
      this.upcomingStays(hostId, now),
      this.propertiesOverview(hostId),
      this.calendarHealth(hostId),
      this.attention(hostId),
    ]);

    return {
      attention,
      today: { date: now, arrivals, departures },
      pendingRequests,
      upcomingStays,
      properties,
      calendarSync,
    };
  }

  private async hostTimeZone(hostId: string): Promise<string> {
    const rows = (await this.database.db.execute(sql`
      SELECT time_zone FROM properties WHERE host_id = ${hostId} LIMIT 1
    `)) as unknown as { time_zone: string }[];

    return rows[0]?.time_zone ?? "Europe/Warsaw";
  }

  /** Arrivals and departures share a shape; only the date column differs. */
  private async bookingsOn(
    hostId: string,
    column: "check_in" | "check_out",
    date: string,
  ): Promise<OperationalBookingDto[]> {
    const rows = (await this.database.db.execute(sql`
      SELECT ${sql.raw(BOOKING_COLUMNS)}
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      WHERE b.host_id = ${hostId}
        AND b.status = 'CONFIRMED'
        AND b.${sql.raw(column)} = ${date}::date
      ORDER BY b.check_in ASC
    `)) as unknown as BookingRowRaw[];

    return rows.map(toOperationalBooking);
  }

  private async pendingRequests(hostId: string): Promise<OperationalBookingDto[]> {
    const rows = (await this.database.db.execute(sql`
      SELECT ${sql.raw(BOOKING_COLUMNS)}
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      WHERE b.host_id = ${hostId}
        AND b.status = 'PENDING_HOST_APPROVAL'
      -- Soonest deadline first: that is the one about to be lost.
      ORDER BY b.host_response_deadline_at ASC NULLS LAST
    `)) as unknown as BookingRowRaw[];

    return rows.map(toOperationalBooking);
  }

  private async upcomingStays(
    hostId: string,
    date: string,
  ): Promise<OperationalBookingDto[]> {
    const rows = (await this.database.db.execute(sql`
      SELECT ${sql.raw(BOOKING_COLUMNS)}
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      WHERE b.host_id = ${hostId}
        AND b.status = 'CONFIRMED'
        AND b.check_in > ${date}::date
      ORDER BY b.check_in ASC
      LIMIT ${UPCOMING_LIMIT}
    `)) as unknown as BookingRowRaw[];

    return rows.map(toOperationalBooking);
  }

  private async propertiesOverview(hostId: string): Promise<PropertiesOverviewDto> {
    const rows = (await this.database.db.execute(sql`
      SELECT status, count(*)::int AS count
      FROM properties
      WHERE host_id = ${hostId}
      GROUP BY status
    `)) as unknown as { status: string; count: number }[];

    const by = (status: string) =>
      rows.find((row) => row.status === status)?.count ?? 0;

    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      published: by("PUBLISHED"),
      draft: by("DRAFT"),
      suspended: by("SUSPENDED"),
      archived: by("ARCHIVED"),
    };
  }

  private async calendarHealth(hostId: string): Promise<CalendarSyncHealthDto> {
    const rows = (await this.database.db.execute(sql`
      SELECT c.status,
             c.last_error_code,
             c.last_sync_succeeded_at
      FROM external_calendars c
      JOIN properties p ON p.id = c.property_id
      WHERE p.host_id = ${hostId}
    `)) as unknown as {
      status: string;
      last_error_code: string | null;
      last_sync_succeeded_at: string | null;
    }[];

    const staleBefore = Date.now() - this.staleAfterMinutes * 60_000;

    let healthy = 0;
    let failed = 0;
    let stale = 0;
    let disabled = 0;

    for (const row of rows) {
      if (row.status === "DISABLED") {
        disabled += 1;
        continue;
      }
      if (row.last_error_code) {
        failed += 1;
        continue;
      }
      if (
        !row.last_sync_succeeded_at ||
        toDate(row.last_sync_succeeded_at).getTime() < staleBefore
      ) {
        stale += 1;
        continue;
      }
      healthy += 1;
    }

    return {
      active: rows.filter((row) => row.status === "ACTIVE").length,
      healthy,
      failed,
      stale,
      disabled,
    };
  }

  /**
   * Everything asking for a decision, in one list.
   *
   * Built from the same rows the rest of the dashboard reads — a Property is
   * "not ready" according to the very function `publish` uses, so the warning
   * and the refusal can never disagree (§10).
   */
  private async attention(hostId: string): Promise<AttentionItemDto[]> {
    const staleBefore = new Date(Date.now() - this.staleAfterMinutes * 60_000);

    const [requests, propertyRows, calendars] = await Promise.all([
      this.database.db.execute(sql`
        SELECT b.id, b.public_reference, b.property_id, p.title AS property_title,
               b.check_in, b.check_out, b.created_at, b.host_response_deadline_at
        FROM bookings b
        JOIN properties p ON p.id = b.property_id
        WHERE b.host_id = ${hostId} AND b.status = 'PENDING_HOST_APPROVAL'
      `) as unknown as Promise<
        {
          id: string;
          public_reference: string;
          property_id: string;
          property_title: string;
          check_in: string;
          check_out: string;
          created_at: string;
          host_response_deadline_at: string | null;
        }[]
      >,
      this.database.db.execute(sql`
        SELECT p.id, p.title, p.status, p.description, p.property_type,
               p.country_code, p.city, p.district, p.time_zone,
               p.latitude, p.longitude, p.max_guests, p.beds, p.bathrooms,
               p.base_daily_rate_amount_minor, p.currency, p.updated_at,
               (SELECT count(*)::int FROM property_images i WHERE i.property_id = p.id)
                 AS image_count
        FROM properties p
        WHERE p.host_id = ${hostId} AND p.status <> 'ARCHIVED'
      `) as unknown as Promise<
        Record<string, string | number | null | Date> & { image_count: number }[]
      >,
      this.database.db.execute(sql`
        SELECT c.id, c.name, c.property_id, c.status, c.last_error_code,
               c.last_sync_succeeded_at, c.last_sync_failed_at, c.updated_at
        FROM external_calendars c
        JOIN properties p ON p.id = c.property_id
        WHERE p.host_id = ${hostId} AND c.status = 'ACTIVE'
      `) as unknown as Promise<
        {
          id: string;
          name: string;
          property_id: string;
          status: string;
          last_error_code: string | null;
          last_sync_succeeded_at: string | null;
          last_sync_failed_at: string | null;
          updated_at: string;
        }[]
      >,
    ]);

    const items: AttentionItemDto[] = [];

    for (const request of await requests) {
      const deadline = toDateOrNull(request.host_response_deadline_at);
      const urgent =
        deadline !== null &&
        deadline.getTime() - Date.now() < EXPIRING_SOON_HOURS * 3_600_000;

      items.push({
        type: urgent ? "BOOKING_REQUEST_EXPIRING_SOON" : "BOOKING_REQUEST_PENDING",
        severity: "ACTION",
        propertyId: request.property_id,
        bookingId: request.id,
        title: urgent ? "Prośba wkrótce wygaśnie" : "Nowa prośba o rezerwację",
        description: `${request.property_title} · ${stayLabel(request.check_in, request.check_out)}`,
        actionUrl: `/host/bookings/${request.id}`,
        occurredAt: toIso(request.created_at),
        deadlineAt: deadline?.toISOString() ?? null,
      });
    }

    for (const row of (await propertyRows) as unknown as PropertyAttentionRow[]) {
      if (row.status === "SUSPENDED") {
        items.push({
          type: "PROPERTY_SUSPENDED",
          severity: "WARNING",
          propertyId: row.id,
          bookingId: null,
          title: "Obiekt wycofany z wyszukiwarki",
          description: `${row.title} nie jest widoczny dla gości.`,
          actionUrl: `/host/properties/${row.id}`,
          occurredAt: toIso(row.updated_at),
          deadlineAt: null,
        });
        continue;
      }

      if (row.status !== "DRAFT") continue;

      // The same rule publish enforces, so the two can never disagree.
      const readiness = evaluatePublishReadiness({
        title: row.title,
        description: row.description,
        propertyType: row.property_type,
        countryCode: row.country_code,
        city: row.city,
        district: row.district,
        timeZone: row.time_zone,
        latitude: row.latitude,
        longitude: row.longitude,
        maxGuests: row.max_guests,
        beds: row.beds,
        bathrooms: row.bathrooms,
        baseDailyRateAmountMinor: row.base_daily_rate_amount_minor,
        currency: row.currency,
        imageCount: row.image_count,
      });

      items.push(
        readiness.ready
          ? {
              type: "PROPERTY_DRAFT",
              severity: "INFO",
              propertyId: row.id,
              bookingId: null,
              title: "Szkic gotowy do publikacji",
              description: `${row.title} ma komplet danych — wystarczy opublikować.`,
              actionUrl: `/host/properties/${row.id}`,
              occurredAt: toIso(row.updated_at),
              deadlineAt: null,
            }
          : {
              type: "PROPERTY_NOT_READY_FOR_PUBLISH",
              severity: "WARNING",
              propertyId: row.id,
              bookingId: null,
              title: "Szkic wymaga uzupełnienia",
              description: `${row.title}: brakuje ${readiness.missing.length} ${
                readiness.missing.length === 1 ? "elementu" : "elementów"
              }.`,
              actionUrl: `/host/properties/${row.id}`,
              occurredAt: toIso(row.updated_at),
              deadlineAt: null,
            },
      );
    }

    for (const calendar of await calendars) {
      if (calendar.last_error_code) {
        items.push({
          type: "ICAL_SYNC_FAILED",
          severity: "WARNING",
          propertyId: calendar.property_id,
          bookingId: null,
          title: "Synchronizacja kalendarza nie powiodła się",
          description: `${calendar.name} — terminy mogą być nieaktualne.`,
          actionUrl: `/host/properties/${calendar.property_id}/calendar`,
          occurredAt: toIso(calendar.last_sync_failed_at ?? calendar.updated_at),
          deadlineAt: null,
        });
        continue;
      }

      if (
        !calendar.last_sync_succeeded_at ||
        toDate(calendar.last_sync_succeeded_at) < staleBefore
      ) {
        items.push({
          type: "ICAL_SYNC_STALE",
          severity: "INFO",
          propertyId: calendar.property_id,
          bookingId: null,
          title: "Kalendarz dawno się nie odświeżył",
          description: `${calendar.name} — sprawdź, czy adres feedu wciąż działa.`,
          actionUrl: `/host/properties/${calendar.property_id}/calendar`,
          occurredAt: toIso(calendar.last_sync_succeeded_at ?? calendar.updated_at),
          deadlineAt: null,
        });
      }
    }

    // Urgency first, then whatever runs out soonest, then most recent.
    return items.sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;

      if (a.deadlineAt && b.deadlineAt) return a.deadlineAt.localeCompare(b.deadlineAt);
      if (a.deadlineAt) return -1;
      if (b.deadlineAt) return 1;

      return b.occurredAt.localeCompare(a.occurredAt);
    });
  }
}

type PropertyAttentionRow = {
  id: string;
  title: string;
  status: string;
  description: string | null;
  property_type: string;
  country_code: string;
  city: string;
  district: string;
  time_zone: string;
  latitude: number | null;
  longitude: number | null;
  max_guests: number;
  beds: number;
  bathrooms: number;
  base_daily_rate_amount_minor: number;
  currency: string;
  updated_at: string;
  image_count: number;
};

const BOOKING_COLUMNS = `
  b.id, b.public_reference AS reference, b.status,
  b.property_id, p.title AS property_title,
  b.guest_name, b.check_in, b.check_out,
  b.adults, b.children,
  b.total_amount_minor, b.currency,
  b.host_response_deadline_at
`;

function toOperationalBooking(row: BookingRowRaw): OperationalBookingDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    propertyId: row.property_id,
    propertyTitle: row.property_title,
    guestName: row.guest_name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    adults: row.adults,
    children: row.children,
    totalAmountMinor: row.total_amount_minor,
    currency: row.currency,
    hostResponseDeadlineAt: toIsoOrNull(row.host_response_deadline_at),
  };
}
