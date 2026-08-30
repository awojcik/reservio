import type {
  BookingEventRow,
  BookingRow,
} from "../../infrastructure/database/schema";
import type {
  BookingDto,
  BookingTimelineEntryDto,
  HostBookingDto,
} from "./dto/booking.dto";

function price(booking: BookingRow) {
  return {
    accommodationAmountMinor: booking.accommodationAmountMinor,
    cleaningFeeAmountMinor: booking.cleaningFeeAmountMinor,
    serviceFeeAmountMinor: booking.serviceFeeAmountMinor,
    taxAmountMinor: booking.taxAmountMinor,
    discountAmountMinor: booking.discountAmountMinor,
    totalAmountMinor: booking.totalAmountMinor,
    currency: booking.currency,
  };
}

/**
 * Cancellation is offered only while it means something. The backend decides —
 * the button appearing is a consequence, not the rule (milestone 05 §57).
 */
export function canCancel(booking: BookingRow): boolean {
  return (
    booking.status === "PENDING_HOST_APPROVAL" || booking.status === "PENDING_PAYMENT"
  );
}

function timeline(events: BookingEventRow[]): BookingTimelineEntryDto[] {
  return events.map((event) => ({
    type: event.type,
    actorType: event.actorType,
    createdAt: event.createdAt.toISOString(),
  }));
}

/**
 * The Guest view. No internal id, no Host id, and none of the Guest contact
 * details echoed back — the reference is what identifies the Booking.
 */
export function toBookingDto(
  booking: BookingRow,
  holdExpiresAt: Date | null,
  events: BookingEventRow[] = [],
): BookingDto {
  return {
    reference: booking.publicReference,
    status: booking.status,
    statusReason: booking.statusReason,
    bookingMode: booking.bookingMode,
    propertyTitle: booking.propertyTitleSnapshot,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    adults: booking.adults,
    children: booking.children,
    price: price(booking),
    holdExpiresAt: holdExpiresAt?.toISOString() ?? null,
    hostResponseDeadlineAt: booking.hostResponseDeadlineAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    timeline: timeline(events),
    allowedActions: { canCancel: canCancel(booking), claimed: booking.guestUserId !== null },
  };
}

/** The Host view: everything above plus the contact needed to act on it. */
export function toHostBookingDto(
  booking: BookingRow,
  holdExpiresAt: Date | null,
  events: BookingEventRow[] = [],
): HostBookingDto {
  return {
    ...toBookingDto(booking, holdExpiresAt, events),
    id: booking.id,
    propertyId: booking.propertyId,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    hostRespondedAt: booking.hostRespondedAt?.toISOString() ?? null,
  };
}
