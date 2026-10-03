import type { BookingStatus } from "@rezervio/api-client";

/** Presentation for the Booking lifecycle. Domain values stay English. */
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  PENDING_HOST_APPROVAL: "Czeka na gospodarza",
  PENDING_PAYMENT: "Czeka na płatność",
  CONFIRMED: "Potwierdzona",
  CANCELLED: "Anulowana",
  EXPIRED: "Wygasła",
  COMPLETED: "Zakończona",
};

export const BOOKING_STATUS_REASONS: Record<string, string> = {
  HOST_REJECTED: "Gospodarz odrzucił prośbę",
  AVAILABILITY_LOST: "Termin zajął się, zanim gospodarz zdążył odpowiedzieć",
  HOLD_EXPIRED: "Czas na dokończenie rezerwacji minął",
  HOST_RESPONSE_TIMEOUT: "Gospodarz nie odpowiedział na czas",
  GUEST_CANCELLED: "Rezerwacja anulowana przez gościa",
  HOST_CANCELLED: "Rezerwacja anulowana przez gospodarza",
  PAYMENT_AFTER_HOLD_EXPIRY:
    "Płatność dotarła po wygaśnięciu blokady terminu — pieniądze wracają w całości",
};

/** Presentation for the Payment lifecycle. Domain values stay English. */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  CREATED: "Rozpoczęta",
  PROCESSING: "W trakcie",
  REQUIRES_ACTION: "Wymaga potwierdzenia",
  SUCCEEDED: "Zapłacona",
  FAILED: "Nieudana",
  CANCELLED: "Anulowana",
  REFUND_PENDING: "Zwrot w toku",
  REFUNDED: "Zwrócona",
  PARTIALLY_REFUNDED: "Zwrócona częściowo",
};

export const BOOKING_MODE_CTA: Record<string, string> = {
  REQUEST_TO_BOOK: "Wyślij prośbę",
  INSTANT_BOOK: "Zarezerwuj",
};

export function isAwaitingHost(status: BookingStatus): boolean {
  return status === "PENDING_HOST_APPROVAL";
}

export function isTerminal(status: BookingStatus): boolean {
  return status === "CANCELLED" || status === "EXPIRED" || status === "COMPLETED";
}

/**
 * Countdown text for a hold. Purely cosmetic — the backend decides when a hold
 * has actually lapsed, so a clock skewed by a minute changes nothing
 * (milestone 04 §37).
 */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "00:00";
  const total = Math.floor(msRemaining / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
