import Link from "next/link";

import type { AdminBookingRow } from "@rezervio/api-client";

import { StatePill } from "@/components/admin/StatusPill";
import { formatMinor } from "@/lib/admin";

/**
 * One Booking table, used by the list, the User view and the Property view.
 *
 * Payment and Settlement status come from the same query that fetched the
 * Bookings — a `LEFT JOIN LATERAL` per row rather than a request per row, so a
 * fifty-row page stays two queries (milestone 11 §36).
 */
export function BookingsTable({ rows }: { rows: AdminBookingRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-[15px] text-muted">Brak rezerwacji.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] font-bold tracking-wide text-muted uppercase">
            <th className="py-2 pr-3">Numer</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Obiekt</th>
            <th className="py-2 pr-3">Gość</th>
            <th className="py-2 pr-3">Pobyt</th>
            <th className="py-2 pr-3">Kwota</th>
            <th className="py-2 pr-3">Płatność</th>
            <th className="py-2">Rozliczenie</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line/60 last:border-0">
              <td className="py-2.5 pr-3">
                <Link
                  href={`/admin/bookings/${row.id}`}
                  className="font-bold text-brand underline underline-offset-2"
                >
                  {row.reference}
                </Link>
              </td>
              <td className="py-2.5 pr-3">
                <StatePill status={row.status} />
              </td>
              <td className="max-w-[220px] truncate py-2.5 pr-3">{row.propertyTitle}</td>
              <td className="max-w-[160px] truncate py-2.5 pr-3">{row.guestName}</td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                {row.checkIn} → {row.checkOut}
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                {formatMinor(row.totalAmountMinor, row.currency)}
              </td>
              <td className="py-2.5 pr-3">
                <StatePill status={row.paymentStatus} />
              </td>
              <td className="py-2.5">
                <StatePill status={row.settlementStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
