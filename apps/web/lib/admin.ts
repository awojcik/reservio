import type { IssueSeverity } from "@rezervio/api-client";

/**
 * Presentation for the admin panel.
 *
 * Domain values stay English and stable; only what a person reads is Polish
 * (domain language §2). Nothing here decides anything — the backend owns every
 * rule, and this file owns the wording.
 */

/**
 * Four visual states and no more.
 *
 * A screen listing everything that is currently wrong stops being readable the
 * moment it has nine colours. OK / Pending / Warning / Failed is enough to
 * triage, and the label always carries the meaning so colour is never the only
 * signal (milestone 11 §37).
 */
export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  OK: "OK",
  PENDING: "Oczekuje",
  WARNING: "Uwaga",
  FAILED: "Błąd",
};

export const SEVERITY_TONES: Record<IssueSeverity, string> = {
  OK: "border-success/35 bg-success/12 text-success",
  PENDING: "border-line bg-background text-muted",
  WARNING: "border-accent-edge/35 bg-accent/12 text-ink",
  FAILED: "border-accent-edge bg-accent/20 text-ink",
};

export const CATEGORY_LABELS: Record<string, string> = {
  PAYMENT: "Płatności",
  REFUND: "Zwroty",
  SETTLEMENT: "Rozliczenia",
  TRANSFER: "Przelewy",
  PAYOUT: "Wypłaty",
  ICAL: "Kalendarze",
  NOTIFICATION: "Powiadomienia",
  JOB: "Zadania",
  WEBHOOK: "Webhooki",
};

/** What each safe action is called on a button. */
export const ACTION_LABELS: Record<string, string> = {
  RETRY_NOTIFICATION: "Ponów powiadomienie",
  RETRY_REFUND: "Ponów zwrot",
  RETRY_TRANSFER: "Ponów przelew",
  RETRY_JOB: "Ponów zadanie",
  ICAL_RESYNC: "Synchronizuj kalendarz",
  REFRESH_CONNECT_STATUS: "Odśwież konto Connect",
  RECONCILE: "Uruchom rekoncyliację",
};

export const SEARCH_KIND_LABELS: Record<string, string> = {
  BOOKING: "Rezerwacja",
  USER: "Użytkownik",
  HOST: "Gospodarz",
  PROPERTY: "Obiekt",
  PAYMENT: "Płatność",
  REFUND: "Zwrot",
  SETTLEMENT: "Rozliczenie",
  TRANSFER: "Przelew",
  PAYOUT: "Wypłata",
};

/**
 * Where each money state sits on the four-state scale.
 *
 * Anything not listed is treated as in progress rather than fine: an unknown
 * state is exactly the thing an operator should look at, and defaulting to OK
 * would hide it.
 */
const OK_STATES = new Set([
  "SUCCEEDED",
  "CONFIRMED",
  "COMPLETED",
  "TRANSFERRED",
  "PAID",
  "SENT",
  "PROCESSED",
  "READY",
  "ACTIVE",
  "PUBLISHED",
]);

const FAILED_STATES = new Set(["FAILED", "RESTRICTED", "CANCELLED", "EXPIRED", "REVERSED"]);

export function severityOfStatus(status: string | null | undefined): IssueSeverity {
  if (!status) return "PENDING";
  if (OK_STATES.has(status)) return "OK";
  if (FAILED_STATES.has(status)) return "FAILED";
  return "PENDING";
}

/** Minor units and an ISO code, the way they are stored. Never a float. */
export function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

const DATE_TIME = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatInstant(value: string | null | undefined): string {
  return value ? DATE_TIME.format(new Date(value)) : "—";
}

export function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}
