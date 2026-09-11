import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import type { AdminSearchHitDto, AdminSearchKind } from "./dto/admin-search.dto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stripe's own ids are recognisable, which is most of what makes them useful. */
const PROVIDER_ID = /^(pi|re|tr|po|ch|acct|trr)_[A-Za-z0-9]+$/;

type Hit = {
  kind: string;
  id: string;
  label: string;
  description: string;
  booking_id: string | null;
};

/**
 * One box, every identifier support might be handed.
 *
 * A caller on the phone reads a Booking reference; a Stripe email quotes
 * `pi_…`; a complaint arrives with an address. Making support know in advance
 * which of nine tables to look in is the difference between a one-minute
 * answer and a ten-minute one (milestone 11 §6).
 *
 * Every branch is a parameterised query. The term is never interpolated into
 * SQL, and the `%` wrapping for the fuzzy branches is done as a *bound value*,
 * so a term full of quotes is a term that finds nothing rather than a term
 * that runs (milestone 11 §24).
 */
@Injectable()
export class AdminSearchService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async search(rawTerm: string, limit: number): Promise<AdminSearchHitDto[]> {
    const term = rawTerm.trim();
    if (term.length < 2) return [];

    const hits = await Promise.all([
      this.bookings(term, limit),
      this.users(term, limit),
      this.hosts(term, limit),
      this.properties(term, limit),
      this.financial(term, limit),
    ]);

    return hits.flat().slice(0, limit).map((hit) => this.toDto(hit));
  }

  private toDto(hit: Hit): AdminSearchHitDto {
    const kind = hit.kind as AdminSearchKind;
    return {
      kind,
      id: hit.id,
      label: hit.label,
      description: hit.description,
      href: hrefFor(kind, hit.id, hit.booking_id),
      bookingId: hit.booking_id,
    };
  }

  /**
   * Reference first, id second. The reference is what a person quotes, so an
   * exact match on it outranks everything; the prefix match after it covers
   * somebody who read out only the first few characters.
   */
  private async bookings(term: string, limit: number): Promise<Hit[]> {
    const upper = term.toUpperCase();

    return this.query(sql`
      SELECT
        'BOOKING' AS kind,
        b.id::text AS id,
        b.public_reference || ' · ' || b.property_title_snapshot AS label,
        b.status || ' · ' || b.check_in || ' → ' || b.check_out AS description,
        b.id::text AS booking_id
      FROM bookings b
      WHERE b.public_reference = ${upper}
         OR (${UUID.test(term)} AND b.id::text = ${term})
         OR b.public_reference LIKE ${`${upper}%`}
      ORDER BY (b.public_reference = ${upper}) DESC, b.created_at DESC
      LIMIT ${limit}
    `);
  }

  private async users(term: string, limit: number): Promise<Hit[]> {
    const email = term.toLowerCase();

    return this.query(sql`
      SELECT
        'USER' AS kind,
        u.id::text AS id,
        u.email AS label,
        COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), 'Bez nazwiska')
          || CASE WHEN cardinality(u.roles) > 0 THEN ' · ' || array_to_string(u.roles, ', ') ELSE '' END AS description,
        NULL::text AS booking_id
      FROM users u
      WHERE u.email = ${email}
         OR (${UUID.test(term)} AND u.id::text = ${term})
         OR u.email LIKE ${`%${email}%`}
      ORDER BY (u.email = ${email}) DESC, u.created_at DESC
      LIMIT ${limit}
    `);
  }

  private async hosts(term: string, limit: number): Promise<Hit[]> {
    const needle = term.toLowerCase();

    return this.query(sql`
      SELECT
        'HOST' AS kind,
        h.id::text AS id,
        h.display_name AS label,
        COALESCE(u.email, 'Konto bez logowania') AS description,
        NULL::text AS booking_id
      FROM hosts h
      LEFT JOIN users u ON u.id = h.user_id
      WHERE (${UUID.test(term)} AND h.id::text = ${term})
         OR lower(u.email) LIKE ${`%${needle}%`}
         OR lower(h.display_name) LIKE ${`%${needle}%`}
      ORDER BY h.created_at DESC
      LIMIT ${limit}
    `);
  }

  private async properties(term: string, limit: number): Promise<Hit[]> {
    const needle = term.toLowerCase();

    return this.query(sql`
      SELECT
        'PROPERTY' AS kind,
        p.id::text AS id,
        p.title AS label,
        p.status || ' · ' || p.city AS description,
        NULL::text AS booking_id
      FROM properties p
      WHERE (${UUID.test(term)} AND p.id::text = ${term})
         OR lower(p.title) LIKE ${`%${needle}%`}
         OR p.slug = ${needle}
      ORDER BY p.created_at DESC
      LIMIT ${limit}
    `);
  }

  /**
   * Payment, Refund, Settlement, Transfer and Payout in one pass.
   *
   * Skipped entirely unless the term looks like an id of some kind — a fuzzy
   * search across five financial tables would be five sequential scans in
   * exchange for nothing anybody wants.
   */
  private async financial(term: string, limit: number): Promise<Hit[]> {
    const isUuid = UUID.test(term);
    if (!isUuid && !PROVIDER_ID.test(term)) return [];

    return this.query(sql`
      SELECT 'PAYMENT' AS kind, p.id::text AS id,
             'Płatność ' || p.status AS label,
             b.public_reference || ' · ' || (p.amount_minor / 100.0)::numeric(12,2) || ' ' || p.currency AS description,
             b.id::text AS booking_id
      FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE (${isUuid} AND p.id::text = ${term}) OR p.provider_payment_id = ${term}

      UNION ALL

      SELECT 'REFUND', r.id::text,
             'Zwrot ' || r.status,
             b.public_reference || ' · ' || r.reason,
             b.id::text
      FROM refunds r JOIN bookings b ON b.id = r.booking_id
      WHERE (${isUuid} AND r.id::text = ${term}) OR r.provider_refund_id = ${term}

      UNION ALL

      SELECT 'SETTLEMENT', s.id::text,
             'Rozliczenie ' || s.status,
             b.public_reference || ' · ' || (s.host_amount_minor / 100.0)::numeric(12,2) || ' ' || s.currency,
             b.id::text
      FROM booking_settlements s JOIN bookings b ON b.id = s.booking_id
      WHERE (${isUuid} AND s.id::text = ${term}) OR s.provider_transfer_id = ${term}

      UNION ALL

      SELECT 'TRANSFER', t.id::text,
             'Przelew ' || t.status,
             b.public_reference || ' · ' || (t.amount_minor / 100.0)::numeric(12,2) || ' ' || t.currency,
             b.id::text
      FROM host_transfers t
      JOIN booking_settlements s ON s.id = t.settlement_id
      JOIN bookings b ON b.id = s.booking_id
      WHERE (${isUuid} AND t.id::text = ${term}) OR t.provider_transfer_id = ${term}

      UNION ALL

      SELECT 'PAYOUT', po.id::text,
             'Wypłata ' || po.status,
             h.display_name || ' · ' || (po.amount_minor / 100.0)::numeric(12,2) || ' ' || po.currency,
             NULL::text
      FROM host_payouts po JOIN hosts h ON h.id = po.host_id
      WHERE (${isUuid} AND po.id::text = ${term}) OR po.provider_payout_id = ${term}

      LIMIT ${limit}
    `);
  }

  private async query(statement: ReturnType<typeof sql>): Promise<Hit[]> {
    return (await this.database.db.execute(statement)) as unknown as Hit[];
  }
}

/** Where a hit leads in the admin UI. Financial rows lead to their Booking. */
function hrefFor(kind: AdminSearchKind, id: string, bookingId: string | null): string {
  switch (kind) {
    case "BOOKING":
      return `/admin/bookings/${id}`;
    case "USER":
      return `/admin/users/${id}`;
    case "HOST":
      return `/admin/hosts/${id}`;
    case "PROPERTY":
      return `/admin/properties/${id}`;
    default:
      return bookingId ? `/admin/bookings/${bookingId}` : "/admin/operations";
  }
}
