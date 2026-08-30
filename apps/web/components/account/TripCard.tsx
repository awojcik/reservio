import Link from "next/link";

import type { Trip } from "@rezervio/api-client";

import { BookingStatusBadge } from "@/components/host/BookingStatusBadge";
import { ImageWithFallback } from "@/components/ui/ImageWithFallback";
import { buttonStyles } from "@/components/ui/Button";
import { formatAmountMinor, formatGuests, formatLongDateRange } from "@/lib/format";

/**
 * Renders from the Booking's own snapshot, so a trip stays readable after the
 * Property is delisted (milestone 06 §33).
 */
export function TripCard({ trip }: { trip: Trip }) {
  return (
    <li className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-3 sm:flex-row sm:items-center sm:p-4">
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-[10px] bg-placeholder sm:w-[140px]">
        {trip.coverImageUrl ? (
          <ImageWithFallback
            src={trip.coverImageUrl}
            alt={trip.propertyTitle}
            fill
            sizes="140px"
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[12px] font-bold text-muted">
            Brak zdjęcia
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatusBadge status={trip.status} />
          <span className="text-[12px] font-bold text-muted tabular-nums">
            {trip.reference}
          </span>
        </div>

        <h3 className="mt-1.5 truncate text-[18px] font-bold tracking-tight">
          {trip.propertyTitle}
        </h3>
        {trip.propertyCity ? (
          <p className="mt-0.5 text-[14px] text-muted">{trip.propertyCity}</p>
        ) : null}

        <p className="mt-1 text-[14px] text-muted">
          {formatLongDateRange(trip.checkIn, trip.checkOut)} ·{" "}
          {formatGuests(trip.adults, trip.children)} ·{" "}
          <span className="font-semibold text-ink">
            {formatAmountMinor(trip.price.totalAmountMinor)}
          </span>
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/account/trips/${trip.reference}`}
            className={buttonStyles("primary", "sm")}
          >
            Zobacz szczegóły
          </Link>
          {/* Only linked while the Property is still public. */}
          {trip.propertySlug ? (
            <Link
              href={`/property/${trip.propertySlug}`}
              className={buttonStyles("outline", "sm")}
            >
              Obiekt
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
