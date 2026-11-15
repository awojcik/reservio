/**
 * What a Guest is told when a payment does not go through.
 *
 * Never the provider's raw text: it is written for developers as often as for
 * people, it changes without notice, and it can say more about the
 * environment than a Guest should read. Each case below maps to something the
 * Guest can act on.
 */

/** The parts of a Stripe.js error worth reading — never the whole object. */
export type ConfirmError = {
  type?: string;
  code?: string;
  decline_code?: string;
};

export const PAYMENT_MESSAGES = {
  declined: "Płatność została odrzucona. Spróbuj inną kartą.",
  authentication: "Wymagane jest dodatkowe potwierdzenie płatności. Spróbuj ponownie.",
  details: "Sprawdź dane karty i spróbuj ponownie.",
  connection: "Nie udało się połączyć z operatorem płatności. Spróbuj ponownie.",
  expired: "Sesja rezerwacji wygasła. Sprawdź ponownie dostępność.",
  notPayable: "Ta rezerwacja nie oczekuje na płatność.",
  unavailable: "Płatności są chwilowo niedostępne. Spróbuj ponownie za chwilę.",
  generic: "Nie udało się przetworzyć płatności. Spróbuj ponownie.",
} as const;

const AUTHENTICATION_CODES = new Set([
  "authentication_required",
  "payment_intent_authentication_failure",
  "setup_intent_authentication_failure",
]);

const DETAILS_CODES = new Set([
  "incorrect_number",
  "invalid_number",
  "invalid_expiry_month",
  "invalid_expiry_year",
  "invalid_cvc",
  "incorrect_cvc",
  "incomplete_number",
  "incomplete_expiry",
  "incomplete_cvc",
  "incomplete_zip",
  "incorrect_zip",
  "expired_card",
]);

/** A failed `stripe.confirmPayment`, in the Guest's terms. */
export function confirmErrorMessage(error: ConfirmError): string {
  const code = error.code ?? "";

  if (AUTHENTICATION_CODES.has(code) || error.decline_code === "authentication_required") {
    return PAYMENT_MESSAGES.authentication;
  }
  if (DETAILS_CODES.has(code) || error.type === "validation_error") {
    return PAYMENT_MESSAGES.details;
  }
  if (error.type === "card_error" || code === "card_declined") {
    return PAYMENT_MESSAGES.declined;
  }
  if (error.type === "api_connection_error" || error.type === "rate_limit_error") {
    return PAYMENT_MESSAGES.connection;
  }
  return PAYMENT_MESSAGES.generic;
}

/** Starting a payment was refused by Rezervio's own API. */
export function startErrorMessage(code: string | undefined, status: number | undefined): string {
  if (code === "BOOKING_HOLD_EXPIRED") return PAYMENT_MESSAGES.expired;
  if (code === "BOOKING_NOT_PAYABLE") return PAYMENT_MESSAGES.notPayable;
  // The provider refused or could not be reached — reported by the API as a
  // gateway error, never as the Guest's fault.
  if (status === 502 || status === 503 || status === 504) return PAYMENT_MESSAGES.connection;
  return PAYMENT_MESSAGES.generic;
}

/**
 * What a developer needs to trace a failed attempt, and nothing a Guest typed:
 * no card data, no client secret. Only the identifiers Stripe's dashboard
 * searches by.
 */
export function diagnosticsOf(
  error: ConfirmError & { request_log_url?: string; payment_intent?: { id?: string } },
): Record<string, string | undefined> {
  return {
    type: error.type,
    code: error.code,
    declineCode: error.decline_code,
    requestLogUrl: error.request_log_url,
    paymentIntentId: error.payment_intent?.id,
  };
}
