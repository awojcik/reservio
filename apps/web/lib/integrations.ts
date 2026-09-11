import type { IntegrationStatus } from "@rezervio/api-client";

/**
 * Presentation for the integrations area.
 *
 * Domain values stay English and stable; only what a person reads is Polish
 * (domain language §2).
 */
export const PROVIDER_LABELS: Record<string, string> = {
  HOSTAWAY: "Hostaway",
  CHANNEX: "Channex",
};

/**
 * What each provider *is*, in one line.
 *
 * The two relationships are genuinely different and the Host needs to know
 * which is which: with a PMS, Rezervio reads somebody else's system; with a
 * channel manager, Rezervio is the channel being read (milestone 12 §17).
 */
export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  HOSTAWAY:
    "System zarządzania obiektami (PMS). Rezervio pobiera z niego rezerwacje i przekazuje mu własne.",
  CHANNEX:
    "Channel manager. To on odpytuje Rezervio — Rezervio występuje tu jako kanał sprzedaży, nie jako klient.",
};

export const STATUS_LABELS: Record<string, string> = {
  NOT_CONNECTED: "Niepodłączone",
  PENDING: "W trakcie",
  CONNECTED: "Połączone",
  DEGRADED: "Ostatnia synchronizacja nieudana",
  DISCONNECTED: "Rozłączone",
  ACTION_REQUIRED: "Wymaga działania",
};

/**
 * Why a connection is not simply working.
 *
 * `PARTNER_ACCESS_REQUIRED` is the honest one: the code is right and the
 * onboarding has not happened (milestone 12 §21).
 */
export const STATUS_REASON_LABELS: Record<string, string> = {
  PARTNER_ACCESS_REQUIRED:
    "Wymaga dostępu partnerskiego: konta staging, rejestracji kanału i certyfikacji u dostawcy.",
  CREDENTIALS_MISSING: "Brak zapisanych danych dostępowych.",
  CREDENTIALS_REJECTED: "Dostawca odrzucił dane dostępowe — połącz ponownie.",
  PROVIDER_UNAVAILABLE: "Dostawca nie odpowiada.",
  DISABLED_BY_HOST: "Rozłączone przez Ciebie.",
  DISABLED_BY_ADMIN: "Wyłączone przez zespół Rezervio.",
};

export const SYNC_TYPE_LABELS: Record<string, string> = {
  PROPERTY_DISCOVERY: "Pobranie listingów",
  INBOUND_RESERVATIONS: "Rezerwacje przychodzące",
  OUTBOUND_PUSH: "Przekazanie rezerwacji",
  OUTBOUND_CANCEL: "Przekazanie anulowania",
  RECONCILIATION: "Uzgodnienie",
  WEBHOOK: "Webhook",
  CONNECTION_CHECK: "Test połączenia",
};

/** Which of the four visual states a connection sits in. */
export function severityOfConnection(
  status: IntegrationStatus | string,
): "OK" | "PENDING" | "WARNING" | "FAILED" {
  if (status === "CONNECTED") return "OK";
  if (status === "DEGRADED") return "WARNING";
  if (status === "ACTION_REQUIRED" || status === "DISCONNECTED") return "FAILED";
  return "PENDING";
}

const DATE_TIME = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatSyncTime(value: string | null | undefined): string {
  return value ? DATE_TIME.format(new Date(value)) : "nigdy";
}
