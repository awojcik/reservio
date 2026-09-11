import type { AttentionSeverity, OperationalBooking } from "@rezervio/api-client";

/**
 * Presentation for the Host operations read models. The domain values stay
 * English; everything a Host reads is Polish and built here, so the dashboard
 * and the unified calendar never disagree about wording.
 */
export const SEVERITY_TONES: Record<AttentionSeverity, string> = {
  ACTION: "border-accent-edge/45 bg-accent/12",
  WARNING: "border-brand/30 bg-brand/[0.07]",
  INFO: "border-line bg-surface",
};

export const SEVERITY_LABELS: Record<AttentionSeverity, string> = {
  ACTION: "Do zrobienia",
  WARNING: "Warto sprawdzić",
  INFO: "Informacja",
};

/**
 * How long is left, in words. Cosmetic only — the backend owns the moment a
 * request actually expires, so a clock a minute off changes nothing.
 */
export function formatTimeRemaining(deadline: string, now = Date.now()): string {
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return "termin minął";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `zostało ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `zostało ${hours} h`;

  return `zostało ${Math.floor(hours / 24)} dni`;
}

export function formatDeadline(deadline: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(deadline));
}

/** Guests as a short line: the dashboard has no room for a full sentence. */
export function guestCount(booking: OperationalBooking): string {
  const total = booking.adults + booking.children;
  return `${total} ${total === 1 ? "gość" : total < 5 ? "gości" : "gości"}`;
}
