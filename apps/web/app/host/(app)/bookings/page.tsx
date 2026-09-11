import type { Metadata } from "next";
import Link from "next/link";

import type { HostBookingsQuery } from "@rezervio/api-client";

import { BookingActions } from "@/components/host/BookingActions";
import { BookingFilters } from "@/components/host/BookingFilters";
import { BookingStatusBadge } from "@/components/host/BookingStatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { formatAmountMinor, formatGuests, formatLongDateRange } from "@/lib/format";
import { formatDeadline } from "@/lib/host-operations";

export const metadata: Metadata = { title: "Rezerwacje" };

const PAGE_SIZE = 20;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Only the values the API declares — an unknown one is dropped, not passed on. */
function pick(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export default async function HostBookingsPage({ searchParams }: PageProps) {
  const resolved = await searchParams;
  const offset = Math.max(0, Number(pick(resolved, "offset") ?? 0)) || 0;

  const query = {
    status: pick(resolved, "status"),
    propertyId: pick(resolved, "propertyId"),
    search: pick(resolved, "search"),
    from: pick(resolved, "from"),
    to: pick(resolved, "to"),
    sort: pick(resolved, "sort"),
    limit: PAGE_SIZE,
    offset,
  } as HostBookingsQuery;

  const client = await createSessionApiClient();
  const [page, properties] = await Promise.all([
    client.listHostBookings(query, { cache: "no-store" }),
    client.listHostProperties({ cache: "no-store" }),
  ]);

  const shown = { from: page.total === 0 ? 0 : offset + 1, to: offset + page.items.length };

  function pageHref(nextOffset: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === "string" && value && key !== "offset") params.set(key, value);
    }
    if (nextOffset > 0) params.set("offset", String(nextOffset));
    const search = params.toString();
    return search ? `/host/bookings?${search}` : "/host/bookings";
  }

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Rezerwacje</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Rezerwacje Twoich obiektów
      </h1>

      <BookingFilters properties={properties} />

      {page.total > 0 ? (
        <p className="mt-5 text-[13px] font-semibold text-muted tabular-nums">
          {shown.from}–{shown.to} z {page.total}
        </p>
      ) : null}

      {page.items.length === 0 ? (
        <p className="mt-4 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
          Nic nie pasuje do tych kryteriów.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {page.items.map((booking) => (
            <li
              key={booking.id}
              className="rounded-[14px] border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <BookingStatusBadge status={booking.status} />
                    <span className="text-[12px] font-bold text-muted tabular-nums">
                      {booking.reference}
                    </span>
                  </div>

                  <h2 className="mt-1.5 truncate text-[17px] font-bold tracking-tight">
                    {booking.propertyTitle}
                  </h2>
                  <p className="mt-0.5 text-[14px] text-muted">
                    {formatLongDateRange(booking.checkIn, booking.checkOut)} ·{" "}
                    {formatGuests(booking.adults, booking.children)} ·{" "}
                    <span className="font-semibold text-ink">
                      {formatAmountMinor(booking.price.totalAmountMinor)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">{booking.guestName}</p>
                  {booking.status === "PENDING_HOST_APPROVAL" &&
                  booking.hostResponseDeadlineAt ? (
                    <p className="mt-0.5 text-[13px] font-semibold text-accent-edge">
                      Odpowiedz do {formatDeadline(booking.hostResponseDeadlineAt)}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <BookingActions bookingId={booking.id} status={booking.status} />
                  <Link
                    href={`/host/bookings/${booking.id}`}
                    className={buttonStyles("outline", "sm")}
                  >
                    Szczegóły
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {offset > 0 || page.hasMore ? (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Strony">
          {offset > 0 ? (
            <Link
              href={pageHref(Math.max(0, offset - PAGE_SIZE))}
              className={buttonStyles("outline", "sm")}
            >
              Poprzednie
            </Link>
          ) : (
            <span />
          )}
          {page.hasMore ? (
            <Link
              href={pageHref(offset + PAGE_SIZE)}
              className={buttonStyles("outline", "sm")}
            >
              Następne
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
