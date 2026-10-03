import type { AdminStripeStatus } from "@rezervio/api-client";

/**
 * The badge the whole panel wears.
 *
 * Rezervio runs against the Stripe sandbox and nothing else: a live key stops
 * the process at startup, so this can never quietly say something other than
 * test mode. It is displayed loudly and permanently so nobody mistakes a
 * sandbox transfer for money that actually moved (milestone 11 §29).
 */
export function StripeModeBadge({ stripe }: { stripe: AdminStripeStatus }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-full border border-highlight bg-highlight px-3 text-[12px] font-bold tracking-wide text-ink"
      title={
        stripe.mode === "UNSET"
          ? "Nie skonfigurowano klucza Stripe — płatności zwrócą błąd dostawcy."
          : "Rezervio działa wyłącznie w sandboxie Stripe. Prawdziwe pieniądze nie są pobierane."
      }
    >
      STRIPE TEST MODE
      {stripe.mode === "UNSET" ? <span className="font-semibold">· brak klucza</span> : null}
    </span>
  );
}
