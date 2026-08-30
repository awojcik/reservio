import type { Metadata } from "next";
import Link from "next/link";

import { BookingActions } from "@/components/host/BookingActions";
import { BookingStatusBadge } from "@/components/host/BookingStatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { formatAmountMinor, formatGuests, formatLongDateRange } from "@/lib/format";

export const metadata: Metadata = { title: "Rezerwacje" };

const FILTERS = [
  { value: "", label: "Wszystkie" },
  { value: "PENDING_HOST_APPROVAL", label: "Do decyzji" },
  { value: "PENDING_PAYMENT", label: "Czeka na płatność" },
  { value: "CANCELLED", label: "Anulowane" },
  { value: "EXPIRED", label: "Wygasłe" },
] as const;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HostBookingsPage({ searchParams }: PageProps) {
  const resolved = await searchParams;
  const status = typeof resolved.status === "string" ? resolved.status : "";

  const client = await createSessionApiClient();
  const bookings = await client.listHostBookings(
    status ? { status } : {},
    { cache: "no-store" },
  );

  const awaiting = bookings.filter(
    (booking) => booking.status === "PENDING_HOST_APPROVAL",
  ).length;

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Rezerwacje</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Rezerwacje Twoich obiektów
      </h1>
      {awaiting > 0 ? (
        <p className="mt-3 text-[16px] font-semibold">
          {awaiting} {awaiting === 1 ? "prośba czeka" : "prośby czekają"} na Twoją decyzję.
        </p>
      ) : null}

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Filtr rezerwacji">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value || "all"}
            href={filter.value ? `/host/bookings?status=${filter.value}` : "/host/bookings"}
            className={`inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-bold transition-colors ${
              status === filter.value
                ? "border-accent bg-accent/12 text-ink"
                : "border-line bg-surface text-ink hover:border-ink/35"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {bookings.length === 0 ? (
        <p className="mt-8 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
          {status ? "Nic w tej kategorii." : "Nie masz jeszcze żadnych rezerwacji."}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {bookings.map((booking) => (
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
                      Odpowiedz do{" "}
                      {new Intl.DateTimeFormat("pl-PL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(booking.hostResponseDeadlineAt))}
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
    </div>
  );
}
