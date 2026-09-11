import Link from "next/link";

import type { OperationalBooking } from "@rezervio/api-client";

import { BookingActions } from "@/components/host/BookingActions";
import { BookingStatusBadge } from "@/components/host/BookingStatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { formatAmountMinor, formatLongDateRange } from "@/lib/format";
import { formatDeadline, formatTimeRemaining, guestCount } from "@/lib/host-operations";

/**
 * One operational line — an arrival, a departure, a pending request or an
 * upcoming stay. Accept/Reject go through the same client component the
 * Bookings list uses, so the Booking state machine has a single entry point
 * (milestone 07 §8, §24).
 */
export function OperationalBookingCard({
  booking,
  showActions = false,
}: {
  booking: OperationalBooking;
  showActions?: boolean;
}) {
  return (
    <li className="rounded-[14px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={booking.status} />
            <span className="text-[12px] font-bold text-muted tabular-nums">
              {booking.reference}
            </span>
          </div>

          <p className="mt-1.5 text-[16px] font-bold tracking-tight">{booking.guestName}</p>
          <p className="mt-0.5 truncate text-[14px] text-muted">{booking.propertyTitle}</p>
          <p className="mt-0.5 text-[14px] text-muted">
            {formatLongDateRange(booking.checkIn, booking.checkOut)} · {guestCount(booking)}{" "}
            ·{" "}
            <span className="font-semibold text-ink">
              {formatAmountMinor(booking.totalAmountMinor)}
            </span>
          </p>

          {booking.hostResponseDeadlineAt ? (
            <p className="mt-0.5 text-[13px] font-semibold text-accent-edge">
              Odpowiedz do {formatDeadline(booking.hostResponseDeadlineAt)} —{" "}
              {formatTimeRemaining(booking.hostResponseDeadlineAt)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showActions ? (
            <BookingActions bookingId={booking.id} status={booking.status} />
          ) : null}
          <Link
            href={`/host/bookings/${booking.id}`}
            className={buttonStyles("outline", "sm")}
          >
            Szczegóły
          </Link>
        </div>
      </div>
    </li>
  );
}
