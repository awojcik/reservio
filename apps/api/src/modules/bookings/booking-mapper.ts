import type {
  BookingEventRow,
  BookingRow,
} from "../../infrastructure/database/schema";
import type { PaymentStateDto } from "../payments/dto/payment.dto";
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

/**
 * Paying — or retrying after a decline — needs a Stay that is still held. Once
 * the hold lapses there is nothing to pay for, and offering the button anyway
 * would take money for dates somebody else may already have
 * (milestone 08 §39).
 */
export function canPay(booking: BookingRow, holdExpiresAt: Date | null): boolean {
  return (
    booking.status === "PENDING_PAYMENT" &&
    holdExpiresAt !== null &&
    holdExpiresAt.getTime() > Date.now()
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
  payment: PaymentStateDto | null = null,
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
    allowedActions: {
      canCancel: canCancel(booking),
      claimed: booking.guestUserId !== null,
      canPay: canPay(booking, holdExpiresAt),
    },
    payment,
  };
}

/** The Host view: everything above plus the contact needed to act on it. */
export function toHostBookingDto(
  booking: BookingRow,
  holdExpiresAt: Date | null,
  events: BookingEventRow[] = [],
  payment: PaymentStateDto | null = null,
): HostBookingDto {
  return {
    ...toBookingDto(booking, holdExpiresAt, events, payment),
    id: booking.id,
    propertyId: booking.propertyId,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    hostRespondedAt: booking.hostRespondedAt?.toISOString() ?? null,
  };
}
