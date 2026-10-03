import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { BookingTimeline } from "@/components/booking/BookingTimeline";
import { BookingActions } from "@/components/host/BookingActions";
import { BookingStatusBadge } from "@/components/host/BookingStatusBadge";
import { HostConversation } from "@/components/host/HostConversation";
import { SensitiveAccessPanel } from "@/components/host/SensitiveAccessPanel";
import { createSessionApiClient } from "@/lib/api-server";
import { BOOKING_STATUS_REASONS } from "@/lib/booking";
import { formatAmountMinor, formatGuests, formatLongDateRange } from "@/lib/format";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Szczegóły rezerwacji" };

export default async function HostBookingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let booking;
  try {
    booking = await client.getHostBooking(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Only meaningful once the Stay is going to happen.
  const confirmed = booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const [access, property] = await Promise.all([
    confirmed
      ? client.getBookingAccessStatus(booking.id, { cache: "no-store" }).catch(() => null)
      : Promise.resolve(null),
    client.getHostProperty(booking.propertyId, { cache: "no-store" }).catch(() => null),
  ]);

  const rows = [
    ["Numer", booking.reference],
    ["Obiekt", booking.propertyTitle],
    ["Termin", formatLongDateRange(booking.checkIn, booking.checkOut)],
    ["Goście", formatGuests(booking.adults, booking.children)],
    ["Gość", booking.guestName],
    ["Email", booking.guestEmail],
    ["Telefon", booking.guestPhone ?? "—"],
    [
      "Sposób rezerwacji",
      booking.bookingMode === "INSTANT_BOOK" ? "Natychmiastowa" : "Prośba o rezerwację",
    ],
  ] as const;

  return (
    <div className="py-8 sm:py-10">
      <Link
        href="/host/bookings"
        className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft size={16} strokeWidth={2.4} />
        Wróć do rezerwacji
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BookingStatusBadge status={booking.status} />
        {booking.statusReason ? (
          <span className="text-[13px] text-muted">
            {BOOKING_STATUS_REASONS[booking.statusReason] ?? booking.statusReason}
          </span>
        ) : null}
      </div>

      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        {booking.propertyTitle}
      </h1>

      <div className="mt-6 max-w-[560px] rounded-[14px] border border-line bg-surface p-5">
        <dl className="space-y-2 text-[15px]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-semibold">{value}</dd>
            </div>
          ))}

          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
            <dt className="font-bold">Razem</dt>
            <dd className="text-[19px] font-bold tabular-nums">
              {formatAmountMinor(booking.price.totalAmountMinor)}
            </dd>
          </div>
        </dl>

        {booking.status === "PENDING_HOST_APPROVAL" && booking.hostResponseDeadlineAt ? (
          <p className="mt-4 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-2.5 text-[13px] font-semibold">
            Odpowiedz do{" "}
            {new Intl.DateTimeFormat("pl-PL", {
              dateStyle: "long",
              timeStyle: "short",
            }).format(new Date(booking.hostResponseDeadlineAt))}
            . Potem prośba wygaśnie automatycznie.
          </p>
        ) : null}

        {booking.holdExpiresAt ? (
          <p className="mt-4 rounded-[10px] border border-line bg-background px-3.5 py-2.5 text-[13px]">
            Termin jest zablokowany do{" "}
            {new Intl.DateTimeFormat("pl-PL", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(booking.holdExpiresAt))}
            .
          </p>
        ) : null}

        <BookingTimeline entries={booking.timeline} />

        <div className="mt-5">
          <BookingActions bookingId={booking.id} status={booking.status} />
        </div>
      </div>

      {access ? (
        <SensitiveAccessPanel
          bookingId={booking.id}
          initial={access}
          timeZone={property?.address.timeZone ?? "Europe/Warsaw"}
        />
      ) : null}

      <div className="max-w-[560px]">
        <HostConversation
          bookingId={booking.id}
          guestName={booking.guestName}
          canWrite={booking.status !== "CANCELLED" && booking.status !== "EXPIRED"}
        />
      </div>
    </div>
  );
}
