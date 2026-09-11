import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { toIso } from "../../common/pg-values";
import type {
  IssueCategory,
  IssueCountDto,
  IssueSeverity,
  IssueType,
  OperationalIssueDto,
} from "./dto/admin-operations.dto";

/**
 * How long something may sit in an in-flight state before it stops being
 * patience and starts being a problem. Minutes, all of them generous — an
 * issue list that cries wolf is an issue list nobody reads.
 */
const STUCK_PAYMENT_MINUTES = 60;
const PENDING_REFUND_MINUTES = 60;
const PENDING_TRANSFER_MINUTES = 60;
const UNPROCESSED_WEBHOOK_MINUTES = 15;
const STUCK_OUTBOX_MINUTES = 15;
/** A Settlement past its release moment by this much has not been released. */
const OVERDUE_SETTLEMENT_MINUTES = 60;

type IssueRow = {
  type: string;
  category: string;
  severity: string;
  target_id: string;
  title: string;
  description: string;
  booking_id: string | null;
  booking_reference: string | null;
  host_id: string | null;
  error_code: string | null;
  occurred_at: string;
  /** Only the transfer queries set this; everything else acts on target_id. */
  action_target_id?: string | null;
};

/**
 * Which safe actions make sense for a given issue.
 *
 * Kept next to the issue definition rather than in the UI, so the panel cannot
 * offer an action the backend would refuse — and so adding an issue type is
 * one edit, not two (milestone 11 §10).
 */
const ACTIONS_FOR: Partial<Record<IssueType, string[]>> = {
  PAYMENT_SUCCEEDED_BOOKING_NOT_CONFIRMED: ["RECONCILE"],
  PAYMENT_STUCK_OPEN: ["RECONCILE"],
  REFUND_FAILED: ["RETRY_REFUND"],
  REFUND_PENDING_TOO_LONG: ["RETRY_REFUND"],
  SETTLEMENT_STUCK_PENDING: ["RECONCILE"],
  SETTLEMENT_AVAILABLE_HOST_NOT_READY: ["REFRESH_CONNECT_STATUS", "RETRY_TRANSFER"],
  SETTLEMENT_FAILED: ["RETRY_TRANSFER"],
  TRANSFER_FAILED: ["RETRY_TRANSFER"],
  TRANSFER_PENDING_TOO_LONG: ["RECONCILE"],
  REVERSAL_FAILED: ["RECONCILE"],
  PAYOUT_FAILED: ["RECONCILE"],
  ICAL_SYNC_FAILED: ["ICAL_RESYNC"],
  ICAL_SYNC_STALE: ["ICAL_RESYNC"],
  NOTIFICATION_FAILED: ["RETRY_NOTIFICATION"],
  OUTBOX_STUCK: [],
  WEBHOOK_UNPROCESSED: ["RECONCILE"],
  OUTBOUND_SYNC_FAILED: ["RETRY_OUTBOUND_RESERVATION"],
  INTEGRATION_SYNC_FAILED: ["RETRY_INTEGRATION_SYNC", "RECONCILE_INTEGRATION"],
  INTEGRATION_ACTION_REQUIRED: [],
  EXTERNAL_RESERVATION_CONFLICT: ["RECONCILE_INTEGRATION"],
  PROVIDER_EVENT_UNPROCESSED: ["RETRY_INTEGRATION_SYNC"],
};

/**
 * Everything currently wrong, as one query per category.
 *
 * A read model, never a table. A hand-kept incident list drifts the moment
 * somebody fixes the underlying row without closing the entry; here an issue
 * stops existing the instant its cause does (milestone 11 §12).
 *
 * Each query is bounded and hits an index. None of them returns a provider
 * payload: an operator sees a code and an amount, never the raw object the PSP
 * sent, which routinely carries more about a person than support needs.
 */
@Injectable()
export class OperationalIssuesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly config: ConfigService,
  ) {}

  private get staleCalendarMinutes(): number {
    // The same definition of "stale" the Host dashboard uses — two definitions
    // of one word always start to differ.
    return Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15) * 4;
  }

  /**
   * All issues, newest first.
   *
   * Deliberately one round trip per category and a merge in Node rather than a
   * single UNION: the categories have genuinely different joins, and a
   * seventeen-branch UNION would be unreadable and would defeat the per-branch
   * index choices.
   */
  async all(filter: { category?: IssueCategory; hostId?: string; bookingId?: string } = {}): Promise<
    OperationalIssueDto[]
  > {
    const wanted = filter.category;
    const groups: [IssueCategory, () => Promise<IssueRow[]>][] = [
      ["PAYMENT", () => this.paymentIssues()],
      ["REFUND", () => this.refundIssues()],
      ["SETTLEMENT", () => this.settlementIssues()],
      ["TRANSFER", () => this.transferIssues()],
      ["PAYOUT", () => this.payoutIssues()],
      ["ICAL", () => this.icalIssues()],
      ["NOTIFICATION", () => this.notificationIssues()],
      ["JOB", () => this.outboxIssues()],
      ["WEBHOOK", () => this.webhookIssues()],
      ["INTEGRATION", () => this.integrationIssues()],
    ];

    const results = await Promise.all(
      groups.map(([category, run]) => (wanted && wanted !== category ? [] : run())),
    );

    return results
      .flat()
      .map((row) => this.toDto(row))
      .filter((issue) => !filter.hostId || issue.hostId === filter.hostId)
      .filter((issue) => !filter.bookingId || issue.bookingId === filter.bookingId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  /** Per-category totals for the dashboard tiles. */
  counts(issues: OperationalIssueDto[]): IssueCountDto[] {
    const map = new Map<IssueCategory, IssueCountDto>();

    for (const issue of issues) {
      const entry = map.get(issue.category) ?? {
        category: issue.category,
        total: 0,
        failed: 0,
      };
      entry.total += 1;
      if (issue.severity === "FAILED") entry.failed += 1;
      map.set(issue.category, entry);
    }

    return [...map.values()].sort((a, b) => b.failed - a.failed || b.total - a.total);
  }

  private toDto(row: IssueRow): OperationalIssueDto {
    const type = row.type as IssueType;
    return {
      type,
      category: row.category as IssueCategory,
      severity: row.severity as IssueSeverity,
      targetId: row.target_id,
      // The command that fixes a failed Transfer takes the Settlement: the
      // Transfer row is its consequence, not its identity.
      actionTargetId: row.action_target_id ?? row.target_id,
      title: row.title,
      description: row.description,
      bookingId: row.booking_id,
      bookingReference: row.booking_reference,
      hostId: row.host_id,
      errorCode: row.error_code,
      occurredAt: toIso(row.occurred_at),
      actions: ACTIONS_FOR[type] ?? [],
    };
  }

  // ------------------------------------------------------------------ money

  /**
   * The one that matters most: money took, Stay not confirmed.
   *
   * Normally impossible — the webhook confirms in the same transaction that
   * marks the Payment. It becomes possible when that transaction lost a race
   * with hold expiry, in which case a Refund exists and this is *not* an
   * issue. So the query asks for a succeeded Payment on an unconfirmed Booking
   * with no refund in flight (milestone 11 §12).
   */
  private async paymentIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'PAYMENT_SUCCEEDED_BOOKING_NOT_CONFIRMED' AS type,
        'PAYMENT' AS category,
        'FAILED' AS severity,
        p.id::text AS target_id,
        'Płatność się powiodła, rezerwacja nie jest potwierdzona' AS title,
        b.public_reference || ' · ' || b.status AS description,
        b.id::text AS booking_id,
        b.public_reference AS booking_reference,
        b.host_id::text AS host_id,
        NULL::text AS error_code,
        p.succeeded_at AS occurred_at
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.status = 'SUCCEEDED'
        AND b.status NOT IN ('CONFIRMED','COMPLETED')
        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_id = p.id)

      UNION ALL

      SELECT
        'PAYMENT_STUCK_OPEN',
        'PAYMENT',
        'WARNING',
        p.id::text,
        'Płatność wisi w toku',
        b.public_reference || ' · ' || p.status,
        b.id::text,
        b.public_reference,
        b.host_id::text,
        p.failure_code,
        p.created_at
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.status IN ('CREATED','PROCESSING','REQUIRES_ACTION')
        AND p.created_at < now() - ${sql.raw(`interval '${STUCK_PAYMENT_MINUTES} minutes'`)}
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  private async refundIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        CASE WHEN r.status = 'FAILED' THEN 'REFUND_FAILED' ELSE 'REFUND_PENDING_TOO_LONG' END AS type,
        'REFUND' AS category,
        CASE WHEN r.status = 'FAILED' THEN 'FAILED' ELSE 'WARNING' END AS severity,
        r.id::text AS target_id,
        CASE WHEN r.status = 'FAILED'
          THEN 'Zwrot nie powiódł się'
          ELSE 'Zwrot czeka zbyt długo' END AS title,
        b.public_reference || ' · ' || r.reason AS description,
        b.id::text AS booking_id,
        b.public_reference AS booking_reference,
        b.host_id::text AS host_id,
        r.failure_code AS error_code,
        r.updated_at AS occurred_at
      FROM refunds r
      JOIN bookings b ON b.id = r.booking_id
      WHERE r.status = 'FAILED'
         OR (r.status IN ('PENDING','PROCESSING')
             AND r.created_at < now() - ${sql.raw(`interval '${PENDING_REFUND_MINUTES} minutes'`)})
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  /**
   * Three separate stalls, and the difference matters to whoever is looking:
   * the clock passed and nothing released; the money is available but the Host
   * has no account to send it to; the release itself failed.
   */
  private async settlementIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'SETTLEMENT_STUCK_PENDING' AS type,
        'SETTLEMENT' AS category,
        'WARNING' AS severity,
        s.id::text AS target_id,
        'Rozliczenie nie zwolniło się po terminie' AS title,
        b.public_reference || ' · termin ' || to_char(s.release_at, 'YYYY-MM-DD HH24:MI') AS description,
        b.id::text AS booking_id,
        b.public_reference AS booking_reference,
        s.host_id::text AS host_id,
        NULL::text AS error_code,
        s.release_at AS occurred_at
      FROM booking_settlements s
      JOIN bookings b ON b.id = s.booking_id
      WHERE s.status = 'PENDING'
        AND s.release_at < now() - ${sql.raw(`interval '${OVERDUE_SETTLEMENT_MINUTES} minutes'`)}

      UNION ALL

      SELECT
        'SETTLEMENT_AVAILABLE_HOST_NOT_READY',
        'SETTLEMENT',
        'WARNING',
        s.id::text,
        'Środki gotowe, konto gospodarza nie jest gotowe',
        b.public_reference || ' · ' || COALESCE(a.onboarding_status, 'BRAK KONTA'),
        b.id::text,
        b.public_reference,
        s.host_id::text,
        COALESCE(a.onboarding_status, 'NOT_STARTED'),
        s.available_at
      FROM booking_settlements s
      JOIN bookings b ON b.id = s.booking_id
      LEFT JOIN host_payment_accounts a ON a.host_id = s.host_id
      WHERE s.status = 'AVAILABLE'
        AND (a.id IS NULL OR a.onboarding_status <> 'READY')

      UNION ALL

      SELECT
        'SETTLEMENT_FAILED',
        'SETTLEMENT',
        'FAILED',
        s.id::text,
        'Rozliczenie w stanie błędu',
        b.public_reference || ' · ' || s.status,
        b.id::text,
        b.public_reference,
        s.host_id::text,
        s.failure_code,
        COALESCE(s.failed_at, s.updated_at)
      FROM booking_settlements s
      JOIN bookings b ON b.id = s.booking_id
      WHERE s.status = 'FAILED'
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  private async transferIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'TRANSFER_FAILED' AS type,
        'TRANSFER' AS category,
        'FAILED' AS severity,
        t.id::text AS target_id,
        'Przelew do gospodarza nie powiódł się' AS title,
        b.public_reference || ' · ' || (t.amount_minor / 100.0)::numeric(12,2) || ' ' || t.currency AS description,
        b.id::text AS booking_id,
        b.public_reference AS booking_reference,
        t.host_id::text AS host_id,
        t.failure_code AS error_code,
        COALESCE(t.failed_at, t.updated_at) AS occurred_at,
        s.id::text AS action_target_id
      FROM host_transfers t
      JOIN booking_settlements s ON s.id = t.settlement_id
      JOIN bookings b ON b.id = s.booking_id
      WHERE t.status = 'FAILED'

      UNION ALL

      SELECT
        'TRANSFER_PENDING_TOO_LONG',
        'TRANSFER',
        'WARNING',
        t.id::text,
        'Przelew wisi w toku',
        b.public_reference || ' · ' || t.status,
        b.id::text,
        b.public_reference,
        t.host_id::text,
        NULL::text,
        t.created_at,
        s.id::text
      FROM host_transfers t
      JOIN booking_settlements s ON s.id = t.settlement_id
      JOIN bookings b ON b.id = s.booking_id
      WHERE t.status IN ('PENDING','PROCESSING')
        AND t.created_at < now() - ${sql.raw(`interval '${PENDING_TRANSFER_MINUTES} minutes'`)}

      UNION ALL

      SELECT
        'REVERSAL_FAILED',
        'TRANSFER',
        'FAILED',
        rv.id::text,
        'Cofnięcie przelewu nie powiodło się',
        b.public_reference || ' · ' || rv.reason,
        b.id::text,
        b.public_reference,
        s.host_id::text,
        rv.failure_code,
        COALESCE(rv.failed_at, rv.updated_at),
        s.id::text
      FROM host_transfer_reversals rv
      JOIN booking_settlements s ON s.id = rv.settlement_id
      JOIN bookings b ON b.id = s.booking_id
      WHERE rv.status = 'FAILED'
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  private async payoutIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'PAYOUT_FAILED' AS type,
        'PAYOUT' AS category,
        'FAILED' AS severity,
        po.id::text AS target_id,
        'Wypłata na konto bankowe nie powiodła się' AS title,
        h.display_name || ' · ' || (po.amount_minor / 100.0)::numeric(12,2) || ' ' || po.currency AS description,
        NULL::text AS booking_id,
        NULL::text AS booking_reference,
        po.host_id::text AS host_id,
        po.failure_code AS error_code,
        COALESCE(po.failed_at, po.updated_at) AS occurred_at
      FROM host_payouts po
      JOIN hosts h ON h.id = po.host_id
      WHERE po.status = 'FAILED'
      ORDER BY occurred_at DESC
      LIMIT 100
    `);
  }

  // -------------------------------------------------------------- pipelines

  private async icalIssues(): Promise<IssueRow[]> {
    const stale = sql.raw(`interval '${this.staleCalendarMinutes} minutes'`);

    return this.query(sql`
      SELECT
        CASE WHEN c.consecutive_failures > 0 THEN 'ICAL_SYNC_FAILED' ELSE 'ICAL_SYNC_STALE' END AS type,
        'ICAL' AS category,
        CASE WHEN c.consecutive_failures >= 3 THEN 'FAILED' ELSE 'WARNING' END AS severity,
        c.id::text AS target_id,
        CASE WHEN c.consecutive_failures > 0
          THEN 'Synchronizacja kalendarza nie powiodła się'
          ELSE 'Kalendarz nie synchronizował się od dawna' END AS title,
        p.title || ' · ' || c.provider AS description,
        NULL::text AS booking_id,
        NULL::text AS booking_reference,
        p.host_id::text AS host_id,
        c.last_error_code AS error_code,
        COALESCE(c.last_sync_failed_at, c.last_sync_succeeded_at, c.created_at) AS occurred_at
      FROM external_calendars c
      JOIN properties p ON p.id = c.property_id
      WHERE c.status = 'ACTIVE'
        AND (
          c.consecutive_failures > 0
          OR c.last_sync_succeeded_at IS NULL
          OR c.last_sync_succeeded_at < now() - ${stale}
        )
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  private async notificationIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'NOTIFICATION_FAILED' AS type,
        'NOTIFICATION' AS category,
        'FAILED' AS severity,
        n.id::text AS target_id,
        'Powiadomienie nie zostało dostarczone' AS title,
        b.public_reference || ' · ' || n.type AS description,
        b.id::text AS booking_id,
        b.public_reference AS booking_reference,
        b.host_id::text AS host_id,
        n.last_error_code AS error_code,
        n.updated_at AS occurred_at
      FROM notification_deliveries n
      JOIN bookings b ON b.id = n.booking_id
      WHERE n.status = 'FAILED'
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  /**
   * The outbox is the guarantee that a state change and its notification
   * commit together. A row stuck in it means that guarantee is not being
   * honoured downstream, which is a queue problem, not an email problem.
   */
  private async outboxIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'OUTBOX_STUCK' AS type,
        'JOB' AS category,
        CASE WHEN o.status = 'FAILED' THEN 'FAILED' ELSE 'WARNING' END AS severity,
        o.id::text AS target_id,
        'Zdarzenie utknęło w outboxie' AS title,
        o.type || ' · ' || o.status AS description,
        CASE WHEN o.aggregate_type = 'BOOKING' THEN o.aggregate_id::text ELSE NULL END AS booking_id,
        NULL::text AS booking_reference,
        NULL::text AS host_id,
        NULL::text AS error_code,
        o.created_at AS occurred_at
      FROM outbox_events o
      WHERE o.status = 'FAILED'
         OR (o.status IN ('PENDING','PROCESSING')
             AND o.created_at < now() - ${sql.raw(`interval '${STUCK_OUTBOX_MINUTES} minutes'`)})
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  /**
   * A provider event whose row was claimed but never marked processed: the
   * handler died between the two. Claiming is what makes a replay a no-op, so
   * an unprocessed claim is the one case where a replay would be lost.
   */
  private async webhookIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'WEBHOOK_UNPROCESSED' AS type,
        'WEBHOOK' AS category,
        'WARNING' AS severity,
        e.id::text AS target_id,
        'Zdarzenie dostawcy przyjęte, ale nieprzetworzone' AS title,
        e.event_type AS description,
        NULL::text AS booking_id,
        NULL::text AS booking_reference,
        NULL::text AS host_id,
        NULL::text AS error_code,
        e.created_at AS occurred_at
      FROM payment_provider_events e
      WHERE e.processed_at IS NULL
        AND e.created_at < now() - ${sql.raw(`interval '${UNPROCESSED_WEBHOOK_MINUTES} minutes'`)}
      ORDER BY occurred_at DESC
      LIMIT 100
    `);
  }

  /**
   * Connectivity with an external PMS or channel manager.
   *
   * Four things go wrong here, and they need telling apart. A Booking that was
   * confirmed but never announced to the provider is the serious one: the Stay
   * is sold, the money is taken, and the other channels do not know
   * (milestone 12 §25, §30).
   */
  private async integrationIssues(): Promise<IssueRow[]> {
    return this.query(sql`
      SELECT
        'OUTBOUND_SYNC_FAILED' AS type,
        'INTEGRATION' AS category,
        CASE WHEN r.status = 'FAILED' THEN 'FAILED' ELSE 'WARNING' END AS severity,
        r.id::text AS target_id,
        'Potwierdzona rezerwacja nie trafiła do systemu gospodarza' AS title,
        b.public_reference || ' · ' || c.provider AS description,
        b.id::text AS booking_id,
        b.public_reference AS booking_reference,
        c.host_id::text AS host_id,
        r.last_error_code AS error_code,
        r.updated_at AS occurred_at
      FROM external_reservation_mappings r
      JOIN external_inventory_connections c ON c.id = r.connection_id
      JOIN bookings b ON b.id = r.booking_id
      WHERE r.direction = 'OUTBOUND'
        AND r.status IN ('PENDING','FAILED')

      UNION ALL

      SELECT
        CASE WHEN c.status = 'ACTION_REQUIRED'
          THEN 'INTEGRATION_ACTION_REQUIRED' ELSE 'INTEGRATION_SYNC_FAILED' END,
        'INTEGRATION',
        CASE WHEN c.status = 'ACTION_REQUIRED' THEN 'FAILED' ELSE 'WARNING' END,
        c.id::text,
        CASE WHEN c.status = 'ACTION_REQUIRED'
          THEN 'Połączenie wymaga działania poza Rezervio'
          ELSE 'Synchronizacja z systemem gospodarza nie powiodła się' END,
        c.provider || ' · ' || h.display_name,
        NULL::text,
        NULL::text,
        c.host_id::text,
        COALESCE(c.status_reason, c.last_error_code),
        COALESCE(c.last_failed_sync_at, c.updated_at)
      FROM external_inventory_connections c
      JOIN hosts h ON h.id = c.host_id
      WHERE c.status IN ('DEGRADED','ACTION_REQUIRED')

      UNION ALL

      SELECT
        'PROVIDER_EVENT_UNPROCESSED',
        'INTEGRATION',
        'WARNING',
        e.id::text,
        'Zdarzenie dostawcy przyjęte, ale nieprzetworzone',
        e.provider || ' · ' || e.event_type,
        NULL::text,
        NULL::text,
        c.host_id::text,
        NULL::text,
        e.created_at
      FROM external_provider_events e
      LEFT JOIN external_inventory_connections c ON c.id = e.connection_id
      WHERE e.processed_at IS NULL
        AND e.created_at < now() - ${sql.raw(`interval '${UNPROCESSED_WEBHOOK_MINUTES} minutes'`)}

      UNION ALL

      /*
       * The same nights sold here and at the provider. No amount of blocking
       * fixes it — somebody has to decide which Guest keeps the Stay
       * (milestone 12 §29).
       */
      SELECT
        'EXTERNAL_RESERVATION_CONFLICT',
        'INTEGRATION',
        'FAILED',
        r.id::text,
        'Rezerwacja zewnętrzna nakłada się na potwierdzoną rezerwację Rezervio',
        b.public_reference || ' · ' || r.check_in || ' → ' || r.check_out,
        b.id::text,
        b.public_reference,
        c.host_id::text,
        NULL::text,
        r.updated_at
      FROM external_reservation_mappings r
      JOIN external_inventory_connections c ON c.id = r.connection_id
      JOIN availability_blocks ab ON ab.property_id = r.property_id
        AND ab.source_type = 'BOOKING'
        AND ab.date_range && daterange(r.check_in, r.check_out, '[)')
      JOIN bookings b ON b.id = ab.booking_id AND b.status IN ('CONFIRMED','COMPLETED')
      WHERE r.direction = 'INBOUND'
        AND r.status = 'ACTIVE'
        AND r.check_in IS NOT NULL
      ORDER BY occurred_at DESC
      LIMIT 200
    `);
  }

  private async query(statement: ReturnType<typeof sql>): Promise<IssueRow[]> {
    return (await this.database.db.execute(statement)) as unknown as IssueRow[];
  }
}
