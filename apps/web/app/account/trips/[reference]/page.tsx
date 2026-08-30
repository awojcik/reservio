import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { BookingTimeline } from "@/components/booking/BookingTimeline";
import { CancelBookingButton } from "@/components/booking/CancelBookingButton";
import { BookingStatusBadge } from "@/components/host/BookingStatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { BOOKING_STATUS_REASONS } from "@/lib/booking";
import { formatAmountMinor, formatGuests, formatLongDateRange } from "@/lib/format";

type PageProps = { params: Promise<{ reference: string }> };

export const metadata: Metadata = { title: "Szczegóły podróży" };

export default async function TripDetailPage({ params }: PageProps) {
  const { reference } = await params;
  const client = await createSessionApiClient();

  let trip;
  try {
    trip = await client.getTrip(reference, { cache: "no-store" });
  } catch (error) {
    // Somebody else's trip answers 404 — a 403 would confirm it exists.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const rows = [
    ["Numer", trip.reference],
    ["Obiekt", trip.propertyTitle],
    ...(trip.propertyCity ? ([["Miasto", trip.propertyCity]] as [string, string][]) : []),
    ["Termin", formatLongDateRange(trip.checkIn, trip.checkOut)],
    ["Goście", formatGuests(trip.adults, trip.children)],
  ] as const;

  return (
    <div className="py-8 sm:py-10">
      <Link
        href="/account/trips"
        className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft size={16} strokeWidth={2.4} />
        Wróć do podróży
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BookingStatusBadge status={trip.status} />
        {trip.statusReason ? (
          <span className="text-[13px] text-muted">
            {BOOKING_STATUS_REASONS[trip.statusReason] ?? trip.statusReason}
          </span>
        ) : null}
      </div>

      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        {trip.propertyTitle}
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
              {formatAmountMinor(trip.price.totalAmountMinor)}
            </dd>
          </div>
        </dl>

        <BookingTimeline entries={trip.timeline} />

        {trip.allowedActions.canCancel ? (
          <div className="mt-6 border-t border-line pt-5">
            <CancelBookingButton
              reference={trip.reference}
              awaitingHost={trip.status === "PENDING_HOST_APPROVAL"}
            />
          </div>
        ) : null}
      </div>

      {trip.propertySlug ? (
        <div className="mt-5">
          <Link
            href={`/property/${trip.propertySlug}`}
            className={buttonStyles("outline", "md")}
          >
            Zobacz obiekt
          </Link>
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-muted">
          Ten obiekt nie jest już dostępny publicznie, ale Twoja rezerwacja pozostaje
          w historii.
        </p>
      )}
    </div>
  );
}
