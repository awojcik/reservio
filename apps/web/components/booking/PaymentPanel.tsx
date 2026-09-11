"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Lock, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ApiError, type PaymentIntent } from "@rezervio/api-client";

import { HoldCountdown } from "@/components/booking/HoldCountdown";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { formatAmountMinor } from "@/lib/format";

/**
 * Card details never reach Rezervio.
 *
 * Everything sensitive is entered inside Stripe's own iframe, so the number,
 * CVC and expiry go straight to the provider. Building our own inputs would
 * drag the whole application into PCI scope for no benefit
 * (milestone 08 §14, §40).
 */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/** One loader per page, memoised by the module system. */
let stripePromise: Promise<Stripe | null> | null = null;
function stripe(): Promise<Stripe | null> {
  if (!PUBLISHABLE_KEY) return Promise.resolve(null);
  stripePromise ??= loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

export function PaymentPanel({
  reference,
  totalAmountMinor,
  holdExpiresAt,
}: {
  reference: string;
  totalAmountMinor: number;
  holdExpiresAt: string | null;
}) {
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // State only ever changes after the await, and a stale response from a
  // remounted panel is discarded.
  useEffect(() => {
    let cancelled = false;

    apiClient
      .startPayment(reference)
      .then((started) => {
        if (cancelled) return;
        setIntent(started);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(describe(cause));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (!PUBLISHABLE_KEY) {
    return (
      <Panel>
        <p className="text-[15px] text-muted">
          Płatności nie są skonfigurowane w tym środowisku. Ustaw{" "}
          <code className="font-mono text-[13px]">
            NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
          </code>
          , żeby dokończyć rezerwację.
        </p>
      </Panel>
    );
  }

  if (loading) {
    return (
      <Panel>
        <p className="text-[15px] text-muted">Przygotowuję płatność…</p>
      </Panel>
    );
  }

  if (error || !intent) {
    return (
      <Panel>
        <p className="text-[15px] text-muted">{error ?? "Nie udało się rozpocząć płatności."}</p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[19px] font-bold tracking-tight">Zapłać za rezerwację</h2>
        <span className="text-[20px] font-bold tabular-nums">
          {formatAmountMinor(totalAmountMinor)}
        </span>
      </div>

      {holdExpiresAt ? (
        <p className="mt-1 text-[14px] text-muted">
          Termin trzymamy jeszcze <HoldCountdown expiresAt={holdExpiresAt} />
        </p>
      ) : null}

      <Elements
        stripe={stripe()}
        options={{
          clientSecret: intent.clientSecret,
          appearance: { theme: "flat", variables: { colorPrimary: "#1f4d3f" } },
        }}
      >
        <PaymentForm reference={reference} />
      </Elements>

      <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
        <ShieldCheck size={15} strokeWidth={2.3} className="mt-0.5 shrink-0" />
        Dane karty trafiają bezpośrednio do operatora płatności. Rezervio ich nie widzi
        ani nie przechowuje.
      </p>
    </Panel>
  );
}

function PaymentForm({ reference }: { reference: string }) {
  const stripeJs = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const returnUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : `${window.location.origin}/booking/status/${encodeURIComponent(reference)}`,
    [reference],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripeJs || !elements) return;

    setPending(true);
    setMessage(null);

    /*
     * `redirect: "if_required"` keeps 3-D Secure working: when the bank wants a
     * challenge Stripe navigates away and comes back to `return_url`; when it
     * does not, we stay on the page.
     *
     * Either way the result below is *not* what confirms the Booking. That
     * only happens when the signed webhook reaches the backend
     * (milestone 08 §4, §16).
     */
    const result = await stripeJs.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (result.error) {
      setMessage(
        result.error.message ??
          "Płatność nie powiodła się. Spróbuj ponownie przed wygaśnięciem blokady.",
      );
      setPending(false);
      return;
    }

    // Ask the server what it thinks; the browser's opinion does not count.
    router.refresh();
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <PaymentElement options={{ layout: "tabs" }} />

      {message ? (
        <p
          role="alert"
          className="mt-4 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-2.5 text-[14px]"
        >
          {message}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="accent"
        size="lg"
        className="mt-5 w-full"
        disabled={!stripeJs || pending}
      >
        <Lock size={16} strokeWidth={2.5} />
        {pending ? "Przetwarzam…" : "Zapłać"}
      </Button>
    </form>
  );
}

function Panel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <section className="mt-5 rounded-[14px] border border-line bg-surface p-6">
      {children}
    </section>
  );
}

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "Nie udało się rozpocząć płatności.";

  const body = error.body as { code?: string; message?: { code?: string } } | undefined;
  const code = body?.code ?? body?.message?.code;

  if (code === "BOOKING_HOLD_EXPIRED") {
    return "Termin nie jest już zablokowany. Sprawdź ponownie dostępność.";
  }
  if (code === "BOOKING_NOT_PAYABLE") {
    return "Ta rezerwacja nie oczekuje na płatność.";
  }
  return "Nie udało się rozpocząć płatności. Spróbuj ponownie.";
}
