import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { toIso, toIsoOrNull } from "../../common/pg-values";
import { AppEnvironmentService } from "../../infrastructure/security/security.module";
import { maskEmail } from "./masking";
import type {
  CalendarSyncPageDto,
  NotificationsPageDto,
} from "./dto/admin-operations.dto";
import type {
  AdminBookingDetailDto,
  AdminIntegrationsPageDto,
  AdminBookingRowDto,
  AdminBookingsPageDto,
  AdminHostDetailDto,
  AdminPropertyDetailDto,
  AdminStripeStatusDto,
  AdminUserDetailDto,
} from "./dto/admin-views.dto";
import { OperationalIssuesService } from "./operational-issues.service";

/**
 * Columns shared by every Booking list in the admin panel.
 *
 * One string, so the row shape and the mapper below cannot drift apart, and so
 * the list joins Payment and Settlement in the same query instead of asking
 * per row — a fifty-row page must stay three queries, not a hundred and one
 * (milestone 11 §36).
 */
const BOOKING_ROW_COLUMNS = `
  b.id::text            AS id,
  b.public_reference    AS reference,
  b.status              AS status,
  b.property_title_snapshot AS property_title,
  b.guest_name          AS guest_name,
  b.check_in            AS check_in,
  b.check_out           AS check_out,
  b.total_amount_minor  AS total_amount_minor,
  b.currency            AS currency,
  p.status              AS payment_status,
  s.status              AS settlement_status,
  b.created_at          AS created_at
`;

/**
 * The join that makes the above one query.
 *
 * `LEFT JOIN LATERAL` rather than a plain join because a Booking may have
 * several Payment rows over its life and only the newest is interesting; a
 * plain join would multiply the Booking row instead of decorating it.
 */
const BOOKING_ROW_JOINS = `
  LEFT JOIN LATERAL (
    SELECT status FROM payments WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT status FROM booking_settlements WHERE booking_id = b.id LIMIT 1
  ) s ON true
`;

type BookingRowRaw = {
  id: string;
  reference: string;
  status: string;
  property_title: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  total_amount_minor: number;
  currency: string;
  payment_status: string | null;
  settlement_status: string | null;
  created_at: string;
};

function toBookingRow(row: BookingRowRaw): AdminBookingRowDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    propertyTitle: row.property_title,
    guestName: row.guest_name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    totalAmountMinor: Number(row.total_amount_minor),
    currency: row.currency,
    paymentStatus: row.payment_status,
    settlementStatus: row.settlement_status,
    createdAt: toIso(row.created_at),
  };
}

/**
 * Everything the admin panel reads.
 *
 * Read-only by construction: this service has no commands and writes nothing.
 * Support diagnoses here and acts through `AdminActionsService`, which only
 * knows how to call existing domain commands (milestone 11 §9).
 *
 * No table is copied for the panel's benefit. Every screen is a projection
 * over the same rows the domain writes, so an admin can never be looking at a
 * stale mirror of the truth (§38).
 */
@Injectable()
export class AdminReadService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly issues: OperationalIssuesService,
    private readonly environment: AppEnvironmentService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------- bookings

  async bookings(query: {
    search?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<AdminBookingsPageDto> {
    const search = query.search?.trim().toUpperCase() ?? "";
    const status = query.status?.trim().toUpperCase() ?? "";

    const where = sql`
      WHERE (${search === ""} OR b.public_reference LIKE ${`${search}%`})
        AND (${status === ""} OR b.status = ${status})
    `;

    const [rows, totals] = await Promise.all([
      this.database.db.execute(sql`
        SELECT ${sql.raw(BOOKING_ROW_COLUMNS)}
        FROM bookings b
        ${sql.raw(BOOKING_ROW_JOINS)}
        ${where}
        ORDER BY b.created_at DESC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `) as unknown as Promise<BookingRowRaw[]>,
      this.database.db.execute(sql`
        SELECT count(*)::int AS total FROM bookings b ${where}
      `) as unknown as Promise<{ total: number }[]>,
    ]);

    return { items: rows.map(toBookingRow), total: totals[0]?.total ?? 0 };
  }

  /**
   * One Booking, whole.
   *
   * The screen exists to answer "where did this stop", so the money is laid
   * out in the order it moves — Payment, Refund, Settlement, Transfer, Payout
   * — beside the availability row, the notifications and the audit trail
   * (milestone 11 §7).
   */
  async booking(id: string): Promise<AdminBookingDetailDto> {
    const [core] = (await this.database.db.execute(sql`
      SELECT
        b.*,
        h.display_name AS host_display_name,
        hu.email       AS host_email,
        p.title        AS property_title
      FROM bookings b
      JOIN hosts h ON h.id = b.host_id
      LEFT JOIN users hu ON hu.id = h.user_id
      JOIN properties p ON p.id = b.property_id
      WHERE b.id = ${id}
      LIMIT 1
    `)) as unknown as Record<string, string | number | null>[];

    if (!core) throw new NotFoundException("Nie znaleziono rezerwacji.");

    const [payment, refunds, settlement, transfers, payouts, availability, messages, notifications, events, actions, issues] =
      await Promise.all([
        this.database.db.execute(sql`
          SELECT * FROM payments WHERE booking_id = ${id} ORDER BY created_at DESC LIMIT 1
        `) as unknown as Promise<Record<string, never>[]>,
        this.database.db.execute(sql`
          SELECT * FROM refunds WHERE booking_id = ${id} ORDER BY created_at DESC
        `) as unknown as Promise<Record<string, never>[]>,
        this.database.db.execute(sql`
          SELECT * FROM booking_settlements WHERE booking_id = ${id} LIMIT 1
        `) as unknown as Promise<Record<string, never>[]>,
        this.database.db.execute(sql`
          SELECT t.* FROM host_transfers t
          JOIN booking_settlements s ON s.id = t.settlement_id
          WHERE s.booking_id = ${id}
          ORDER BY t.created_at DESC
        `) as unknown as Promise<Record<string, never>[]>,
        this.database.db.execute(sql`
          SELECT po.* FROM host_payouts po
          WHERE po.host_id = ${core.host_id as string}
          ORDER BY po.created_at DESC
          LIMIT 5
        `) as unknown as Promise<Record<string, never>[]>,
        this.database.db.execute(sql`
          SELECT
            ab.id::text AS id,
            ab.source_type AS source,
            lower(ab.date_range)::text AS start_date,
            upper(ab.date_range)::text AS end_date,
            bh.status AS hold_status,
            bh.expires_at AS hold_expires_at
          FROM availability_blocks ab
          LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
          WHERE ab.booking_id = ${id}
             OR bh.booking_id = ${id}
          ORDER BY start_date
        `) as unknown as Promise<Record<string, string | null>[]>,
        this.database.db.execute(sql`
          SELECT count(*)::int AS total
          FROM booking_messages m
          JOIN booking_conversations c ON c.id = m.conversation_id
          WHERE c.booking_id = ${id}
        `) as unknown as Promise<{ total: number }[]>,
        this.database.db.execute(sql`
          SELECT * FROM notification_deliveries WHERE booking_id = ${id} ORDER BY created_at DESC
        `) as unknown as Promise<Record<string, never>[]>,
        this.database.db.execute(sql`
          SELECT type, actor_type, created_at FROM booking_events
          WHERE booking_id = ${id} ORDER BY created_at ASC
        `) as unknown as Promise<{ type: string; actor_type: string; created_at: string }[]>,
        this.adminActionsFor("BOOKING", id),
        this.issues.all({ bookingId: id }),
      ]);

    const settlementRow = settlement[0] as Record<string, string | number | null> | undefined;

    return {
      id: String(core.id),
      reference: String(core.public_reference),
      status: String(core.status),
      statusReason: (core.status_reason as string | null) ?? null,
      bookingMode: String(core.booking_mode),
      checkIn: String(core.check_in),
      checkOut: String(core.check_out),
      adults: Number(core.adults),
      children: Number(core.children),
      guestName: String(core.guest_name),
      guestEmailMasked: maskEmail(core.guest_email as string),
      guestUserId: (core.guest_user_id as string | null) ?? null,
      hostId: String(core.host_id),
      hostDisplayName: String(core.host_display_name),
      hostEmailMasked: core.host_email ? maskEmail(core.host_email as string) : null,
      propertyId: String(core.property_id),
      propertyTitle: String(core.property_title),
      totalAmountMinor: Number(core.total_amount_minor),
      currency: String(core.currency),
      createdAt: toIso(core.created_at),

      payment: payment[0] ? toPaymentDto(payment[0]) : null,
      refunds: refunds.map(toRefundDto),
      settlement: settlementRow
        ? { ...toSettlementDto(settlementRow), transfers: transfers.map(toTransferDto) }
        : null,
      payouts: payouts.map(toPayoutDto),
      availability: availability.map((row) => ({
        id: String(row.id),
        source: String(row.source),
        startDate: String(row.start_date),
        endDate: String(row.end_date),
        holdStatus: row.hold_status ?? null,
        holdExpiresAt: toIsoOrNull(row.hold_expires_at),
      })),
      messageCount: messages[0]?.total ?? 0,
      notifications: notifications.map(toNotificationDto),
      events: events.map((event) => ({
        type: event.type,
        actorType: event.actor_type,
        createdAt: toIso(event.created_at),
      })),
      issues,
      adminActions: actions,
    };
  }

  // ---------------------------------------------------------------- people

  async user(id: string): Promise<AdminUserDetailDto> {
    const [row] = (await this.database.db.execute(sql`
      SELECT
        u.id::text AS id, u.email, u.first_name, u.last_name, u.roles, u.created_at,
        h.id::text AS host_id, h.display_name AS host_display_name,
        (SELECT count(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS active_sessions,
        (SELECT max(s.last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen_at,
        (SELECT max(s.expires_at) FROM user_sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS session_expires_at
      FROM users u
      LEFT JOIN hosts h ON h.user_id = u.id
      WHERE u.id = ${id}
      LIMIT 1
    `)) as unknown as Record<string, string | number | string[] | null>[];

    if (!row) throw new NotFoundException("Nie znaleziono użytkownika.");

    const bookings = (await this.database.db.execute(sql`
      SELECT ${sql.raw(BOOKING_ROW_COLUMNS)}
      FROM bookings b
      ${sql.raw(BOOKING_ROW_JOINS)}
      WHERE b.guest_user_id = ${id}
      ORDER BY b.created_at DESC
      LIMIT 25
    `)) as unknown as BookingRowRaw[];

    /*
     * No `password_hash` and no session token — not even a truncated one.
     * A support panel that displays half a credential is a support panel that
     * leaks credentials to whoever is standing behind the operator
     * (milestone 11 §8).
     */
    return {
      id: String(row.id),
      email: String(row.email),
      firstName: (row.first_name as string | null) ?? null,
      lastName: (row.last_name as string | null) ?? null,
      roles: (row.roles as string[] | null) ?? [],
      hostId: (row.host_id as string | null) ?? null,
      hostDisplayName: (row.host_display_name as string | null) ?? null,
      createdAt: toIso(row.created_at),
      sessions: {
        active: Number(row.active_sessions ?? 0),
        lastSeenAt: toIsoOrNull(row.last_seen_at),
        expiresAt: toIsoOrNull(row.session_expires_at),
      },
      bookings: bookings.map(toBookingRow),
    };
  }

  async host(id: string): Promise<AdminHostDetailDto> {
    const [row] = (await this.database.db.execute(sql`
      SELECT
        h.id::text AS id, h.display_name, h.user_id::text AS user_id,
        u.email,
        a.provider_account_id, a.onboarding_status, a.charges_enabled, a.payouts_enabled
      FROM hosts h
      LEFT JOIN users u ON u.id = h.user_id
      LEFT JOIN host_payment_accounts a ON a.host_id = h.id
      WHERE h.id = ${id}
      LIMIT 1
    `)) as unknown as Record<string, string | boolean | null>[];

    if (!row) throw new NotFoundException("Nie znaleziono gospodarza.");

    const [properties, settlements, payouts, issues] = await Promise.all([
      this.database.db.execute(sql`
        SELECT id::text AS id, title, status, city FROM properties
        WHERE host_id = ${id} ORDER BY created_at DESC LIMIT 50
      `) as unknown as Promise<{ id: string; title: string; status: string; city: string }[]>,
      this.database.db.execute(sql`
        SELECT * FROM booking_settlements WHERE host_id = ${id}
        ORDER BY created_at DESC LIMIT 25
      `) as unknown as Promise<Record<string, never>[]>,
      this.database.db.execute(sql`
        SELECT * FROM host_payouts WHERE host_id = ${id}
        ORDER BY created_at DESC LIMIT 25
      `) as unknown as Promise<Record<string, never>[]>,
      this.issues.all({ hostId: id }),
    ]);

    return {
      id: String(row.id),
      displayName: String(row.display_name),
      userId: (row.user_id as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      connectReadiness: (row.onboarding_status as string | null) ?? "NONE",
      providerAccountId: (row.provider_account_id as string | null) ?? null,
      chargesEnabled: Boolean(row.charges_enabled),
      payoutsEnabled: Boolean(row.payouts_enabled),
      properties,
      settlements: settlements.map((settlement) => ({
        ...toSettlementDto(settlement),
        transfers: [],
      })),
      payouts: payouts.map(toPayoutDto),
      issues,
    };
  }

  async property(id: string): Promise<AdminPropertyDetailDto> {
    const [row] = (await this.database.db.execute(sql`
      SELECT
        p.id::text AS id, p.title, p.slug, p.status, p.city, p.time_zone,
        p.host_id::text AS host_id, h.display_name AS host_display_name,
        (SELECT count(*)::int FROM availability_blocks ab
           WHERE ab.property_id = p.id AND upper(ab.date_range) > CURRENT_DATE) AS active_blocks,
        (SELECT count(*)::int FROM bookings b
           WHERE b.property_id = p.id AND b.status IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED')) AS active_bookings,
        (SELECT count(*)::int FROM property_stay_information si WHERE si.property_id = p.id) AS stay_info,
        (SELECT count(*)::int FROM property_sensitive_access sa WHERE sa.property_id = p.id) AS sensitive
      FROM properties p
      JOIN hosts h ON h.id = p.host_id
      WHERE p.id = ${id}
      LIMIT 1
    `)) as unknown as Record<string, string | number | null>[];

    if (!row) throw new NotFoundException("Nie znaleziono obiektu.");

    const [calendars, bookings] = await Promise.all([
      this.database.db.execute(sql`
        SELECT id::text AS id, provider, name, status, last_sync_succeeded_at,
               last_error_code, consecutive_failures
        FROM external_calendars WHERE property_id = ${id} ORDER BY created_at
      `) as unknown as Promise<Record<string, string | number | null>[]>,
      this.database.db.execute(sql`
        SELECT ${sql.raw(BOOKING_ROW_COLUMNS)}
        FROM bookings b
        ${sql.raw(BOOKING_ROW_JOINS)}
        WHERE b.property_id = ${id}
        ORDER BY b.created_at DESC
        LIMIT 25
      `) as unknown as Promise<BookingRowRaw[]>,
    ]);

    /*
     * `stayInformationConfigured` and `sensitiveAccessConfigured` are counts
     * turned into booleans on purpose. The door code is AES-GCM ciphertext in
     * the database and stays that way: support may confirm that a Host filled
     * the field in, never read what they put there (milestone 11 §8).
     */
    return {
      id: String(row.id),
      title: String(row.title),
      slug: String(row.slug),
      status: String(row.status),
      city: String(row.city),
      timeZone: String(row.time_zone),
      hostId: String(row.host_id),
      hostDisplayName: String(row.host_display_name),
      activeBlocks: Number(row.active_blocks ?? 0),
      activeBookings: Number(row.active_bookings ?? 0),
      calendars: calendars.map((calendar) => ({
        id: String(calendar.id),
        provider: String(calendar.provider),
        name: String(calendar.name),
        status: String(calendar.status),
        lastSyncSucceededAt: toIsoOrNull(calendar.last_sync_succeeded_at),
        lastErrorCode: (calendar.last_error_code as string | null) ?? null,
        consecutiveFailures: Number(calendar.consecutive_failures ?? 0),
      })),
      stayInformationConfigured: Number(row.stay_info ?? 0) > 0,
      sensitiveAccessConfigured: Number(row.sensitive ?? 0) > 0,
      bookings: bookings.map(toBookingRow),
    };
  }

  // ------------------------------------------------------------- pipelines

  /** Notification deliveries, failures first — that is what support is here for. */
  async notifications(filter: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<NotificationsPageDto> {
    const status = filter.status?.toUpperCase() ?? "";
    const where = sql`WHERE (${status === ""} OR n.status = ${status})`;

    const [rows, totals] = await Promise.all([
      this.database.db.execute(sql`
        SELECT n.*, b.public_reference
        FROM notification_deliveries n
        JOIN bookings b ON b.id = n.booking_id
        ${where}
        ORDER BY (n.status = 'FAILED') DESC, n.updated_at DESC
        LIMIT ${filter.limit} OFFSET ${filter.offset}
      `) as unknown as Promise<Record<string, string | number | null>[]>,
      this.database.db.execute(sql`
        SELECT count(*)::int AS total FROM notification_deliveries n ${where}
      `) as unknown as Promise<{ total: number }[]>,
    ]);

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        bookingId: String(row.booking_id),
        bookingReference: String(row.public_reference),
        type: String(row.type),
        recipientType: String(row.recipient_type),
        recipientMasked: maskEmail(row.recipient_address as string),
        status: String(row.status),
        attemptCount: Number(row.attempt_count ?? 0),
        lastErrorCode: (row.last_error_code as string | null) ?? null,
        sentAt: toIsoOrNull(row.sent_at),
        updatedAt: toIso(row.updated_at),
      })),
      total: totals[0]?.total ?? 0,
    };
  }

  /** Every imported calendar with its health, worst first. */
  async calendars(filter: { limit: number; offset: number }): Promise<CalendarSyncPageDto> {
    const staleMinutes = Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15) * 4;

    const [rows, totals] = await Promise.all([
      this.database.db.execute(sql`
        SELECT
          c.id::text AS id, c.property_id::text AS property_id, p.title AS property_title,
          p.host_id::text AS host_id, c.provider, c.name, c.status,
          c.last_sync_succeeded_at, c.last_sync_failed_at, c.last_error_code,
          c.consecutive_failures,
          CASE
            WHEN c.status <> 'ACTIVE' THEN 'PENDING'
            WHEN c.consecutive_failures >= 3 THEN 'FAILED'
            WHEN c.consecutive_failures > 0 THEN 'WARNING'
            WHEN c.last_sync_succeeded_at IS NULL THEN 'PENDING'
            WHEN c.last_sync_succeeded_at < now() - ${sql.raw(`interval '${staleMinutes} minutes'`)} THEN 'WARNING'
            ELSE 'OK'
          END AS health
        FROM external_calendars c
        JOIN properties p ON p.id = c.property_id
        ORDER BY c.consecutive_failures DESC, c.last_sync_succeeded_at ASC NULLS FIRST
        LIMIT ${filter.limit} OFFSET ${filter.offset}
      `) as unknown as Promise<Record<string, string | number | null>[]>,
      this.database.db.execute(sql`
        SELECT count(*)::int AS total FROM external_calendars
      `) as unknown as Promise<{ total: number }[]>,
    ]);

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        propertyId: String(row.property_id),
        propertyTitle: String(row.property_title),
        hostId: String(row.host_id),
        provider: String(row.provider),
        name: String(row.name),
        status: String(row.status),
        health: String(row.health) as CalendarSyncPageDto["items"][number]["health"],
        lastSyncSucceededAt: toIsoOrNull(row.last_sync_succeeded_at),
        lastSyncFailedAt: toIsoOrNull(row.last_sync_failed_at),
        lastErrorCode: (row.last_error_code as string | null) ?? null,
        consecutiveFailures: Number(row.consecutive_failures ?? 0),
      })),
      total: totals[0]?.total ?? 0,
    };
  }

  // --------------------------------------------------------- connectivity

  /**
   * Every connection across every Host, with the numbers that say whether it
   * is working.
   *
   * One query with correlated counts rather than a query per connection: a
   * marketplace with two hundred connected Hosts must not turn this screen
   * into two hundred round trips (milestone 12 §25).
   *
   * No credentials appear here in any form.
   */
  async integrations(filter: { limit: number; offset: number }): Promise<AdminIntegrationsPageDto> {
    const [rows, totals] = await Promise.all([
      this.database.db.execute(sql`
        SELECT
          c.id::text AS id, c.provider, c.host_id::text AS host_id,
          h.display_name AS host_display_name,
          c.status, c.status_reason, c.external_account_id,
          c.last_successful_sync_at, c.last_failed_sync_at, c.last_error_code,
          (SELECT count(*)::int FROM external_property_mappings m
            WHERE m.connection_id = c.id AND m.status = 'ACTIVE') AS mapped_properties,
          (SELECT count(*)::int FROM external_reservation_mappings r
            WHERE r.connection_id = c.id AND r.direction = 'INBOUND' AND r.status = 'ACTIVE')
            AS inbound_reservations,
          (SELECT count(*)::int FROM external_reservation_mappings r
            WHERE r.connection_id = c.id AND r.direction = 'OUTBOUND'
              AND r.status IN ('PENDING','FAILED')) AS pending_outbound,
          (SELECT count(*)::int FROM external_sync_attempts a
            WHERE a.connection_id = c.id AND a.status = 'FAILED'
              AND a.started_at > now() - interval '1 day') AS failed_syncs,
          (SELECT count(*)::int FROM external_provider_events e
            WHERE e.connection_id = c.id AND e.processed_at IS NULL) AS unprocessed_events
        FROM external_inventory_connections c
        JOIN hosts h ON h.id = c.host_id
        ORDER BY (c.status <> 'CONNECTED') DESC, c.updated_at DESC
        LIMIT ${filter.limit} OFFSET ${filter.offset}
      `) as unknown as Promise<Record<string, string | number | null>[]>,
      this.database.db.execute(sql`
        SELECT count(*)::int AS total FROM external_inventory_connections
      `) as unknown as Promise<{ total: number }[]>,
    ]);

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        provider: String(row.provider),
        hostId: String(row.host_id),
        hostDisplayName: String(row.host_display_name),
        status: String(row.status),
        statusReason: (row.status_reason as string | null) ?? null,
        externalAccountId: (row.external_account_id as string | null) ?? null,
        lastSuccessfulSyncAt: toIsoOrNull(row.last_successful_sync_at),
        lastFailedSyncAt: toIsoOrNull(row.last_failed_sync_at),
        lastErrorCode: (row.last_error_code as string | null) ?? null,
        mappedProperties: Number(row.mapped_properties ?? 0),
        inboundReservations: Number(row.inbound_reservations ?? 0),
        pendingOutbound: Number(row.pending_outbound ?? 0),
        failedSyncs: Number(row.failed_syncs ?? 0),
        unprocessedEvents: Number(row.unprocessed_events ?? 0),
      })),
      total: totals[0]?.total ?? 0,
    };
  }

  // ---------------------------------------------------------------- stripe

  /**
   * The badge the whole panel wears.
   *
   * `mode` can only ever be TEST or UNSET: startup validation refuses to boot
   * against a live key, so a LIVE value cannot reach a running process
   * (milestone 11 §28, §29).
   */
  async stripeStatus(): Promise<AdminStripeStatusDto> {
    const [counts] = (await this.database.db.execute(sql`
      SELECT
        count(*) FILTER (WHERE onboarding_status = 'READY')::int AS ready,
        count(*) FILTER (WHERE onboarding_status <> 'READY')::int AS pending
      FROM host_payment_accounts
    `)) as unknown as { ready: number; pending: number }[];

    return {
      mode: this.environment.stripeMode === "LIVE" ? "LIVE" : this.environment.stripeMode,
      testMode: this.environment.stripeTestMode,
      webhookConfigured: Boolean((this.config.get<string>("STRIPE_WEBHOOK_SECRET") ?? "").trim()),
      connectReadyHosts: counts?.ready ?? 0,
      connectPendingHosts: counts?.pending ?? 0,
    };
  }

  // ----------------------------------------------------------------- audit

  async adminActionsFor(targetType: string, targetId: string) {
    const rows = (await this.database.db.execute(sql`
      SELECT a.*, u.email AS admin_email
      FROM admin_actions a
      JOIN users u ON u.id = a.admin_user_id
      WHERE a.target_type = ${targetType} AND a.target_id = ${targetId}
      ORDER BY a.created_at DESC
      LIMIT 20
    `)) as unknown as Record<string, string | null>[];

    return rows.map(toActionRecord);
  }

  async adminActions(limit: number, offset: number) {
    const [rows, totals] = await Promise.all([
      this.database.db.execute(sql`
        SELECT a.*, u.email AS admin_email
        FROM admin_actions a
        JOIN users u ON u.id = a.admin_user_id
        ORDER BY a.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `) as unknown as Promise<Record<string, string | null>[]>,
      this.database.db.execute(sql`
        SELECT count(*)::int AS total FROM admin_actions
      `) as unknown as Promise<{ total: number }[]>,
    ]);

    return { items: rows.map(toActionRecord), total: totals[0]?.total ?? 0 };
  }

  async recentBookings(limit: number): Promise<AdminBookingRowDto[]> {
    const rows = (await this.database.db.execute(sql`
      SELECT ${sql.raw(BOOKING_ROW_COLUMNS)}
      FROM bookings b
      ${sql.raw(BOOKING_ROW_JOINS)}
      ORDER BY b.created_at DESC
      LIMIT ${limit}
    `)) as unknown as BookingRowRaw[];

    return rows.map(toBookingRow);
  }
}

// --------------------------------------------------------------- mappers

type Raw = Record<string, unknown>;

function toPaymentDto(row: Raw) {
  return {
    id: String(row.id),
    status: String(row.status),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    platformFeeAmountMinor: Number(row.platform_fee_amount_minor ?? 0),
    providerPaymentId: (row.provider_payment_id as string | null) ?? null,
    failureCode: (row.failure_code as string | null) ?? null,
    succeededAt: toIsoOrNull(row.succeeded_at),
    createdAt: toIso(row.created_at),
  };
}

function toRefundDto(row: Raw) {
  return {
    id: String(row.id),
    status: String(row.status),
    reason: String(row.reason),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    providerRefundId: (row.provider_refund_id as string | null) ?? null,
    failureCode: (row.failure_code as string | null) ?? null,
    createdAt: toIso(row.created_at),
  };
}

function toSettlementDto(row: Raw) {
  return {
    id: String(row.id),
    status: String(row.status),
    grossAmountMinor: Number(row.gross_amount_minor),
    platformFeeMinor: Number(row.platform_fee_minor),
    hostAmountMinor: Number(row.host_amount_minor),
    currency: String(row.currency),
    releaseAt: toIso(row.release_at),
    transferredAt: toIsoOrNull(row.transferred_at),
    failureCode: (row.failure_code as string | null) ?? null,
    transfers: [],
  };
}

function toTransferDto(row: Raw) {
  return {
    id: String(row.id),
    status: String(row.status),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    providerTransferId: (row.provider_transfer_id as string | null) ?? null,
    failureCode: (row.failure_code as string | null) ?? null,
    createdAt: toIso(row.created_at),
  };
}

function toPayoutDto(row: Raw) {
  return {
    id: String(row.id),
    status: String(row.status),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    arrivalAt: toIsoOrNull(row.arrival_at),
    failureCode: (row.failure_code as string | null) ?? null,
    createdAt: toIso(row.created_at),
  };
}

function toNotificationDto(row: Raw) {
  return {
    id: String(row.id),
    type: String(row.type),
    recipientType: String(row.recipient_type),
    recipientMasked: maskEmail(row.recipient_address as string),
    status: String(row.status),
    attemptCount: Number(row.attempt_count ?? 0),
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    sentAt: toIsoOrNull(row.sent_at),
  };
}

/** The audit row, with the summary lifted out of its metadata. */
function toActionRecord(row: Raw) {
  let summary: string | null = null;
  let details: Record<string, unknown> = {};

  if (typeof row.metadata_json === "string") {
    try {
      const { summary: text, ...rest } = JSON.parse(row.metadata_json) as {
        summary?: string;
      } & Record<string, unknown>;
      summary = text ?? null;
      details = rest;
    } catch {
      // A metadata blob we cannot parse is a bug, not a reason to hide the row.
      summary = null;
    }
  }

  return {
    id: String(row.id),
    actionType: String(row.action_type),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    status: String(row.status),
    adminEmail: String(row.admin_email),
    summary,
    details,
    createdAt: toIso(row.created_at),
    completedAt: toIsoOrNull(row.completed_at),
  };
}
