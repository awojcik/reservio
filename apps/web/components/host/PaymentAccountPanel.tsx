"use client";

import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink } from "lucide-react";
import { useState } from "react";

import type { HostPaymentStatus } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Connect onboarding, as far as a Host needs it to be payable.
 *
 * The configuration itself happens on the provider's own pages: identity
 * documents and bank details never pass through Rezervio, so there is no KYC
 * form here to build or to get wrong (milestone 08 §30, §31).
 */
const COPY: Record<
  string,
  { title: string; description: string; cta: string | null; tone: "ok" | "warn" | "info" }
> = {
  NOT_STARTED: {
    title: "Płatności nie są jeszcze skonfigurowane",
    description:
      "Skonfiguruj konto rozliczeniowe, żeby móc przyjmować płatności za rezerwacje.",
    cta: "Skonfiguruj płatności",
    tone: "info",
  },
  IN_PROGRESS: {
    title: "Konfiguracja w toku",
    description:
      "Operator płatności czeka na dokończenie danych. To zajmuje zwykle kilka minut.",
    cta: "Dokończ konfigurację",
    tone: "warn",
  },
  RESTRICTED: {
    title: "Konto wymaga uwagi",
    description:
      "Dane zostały wysłane, ale operator wstrzymał część możliwości. Wejdź do konfiguracji, żeby zobaczyć, czego brakuje.",
    cta: "Otwórz konfigurację",
    tone: "warn",
  },
  READY: {
    title: "Możesz przyjmować płatności",
    description: "Konto rozliczeniowe jest gotowe.",
    cta: null,
    tone: "ok",
  },
};

export function PaymentAccountPanel({ initial }: { initial: HostPaymentStatus }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState(false);

  const copy = COPY[status.readiness] ?? COPY.NOT_STARTED;
  const Icon =
    copy.tone === "ok" ? CheckCircle2 : copy.tone === "warn" ? AlertTriangle : CreditCard;

  async function configure() {
    setPending(true);
    try {
      // Creating the account is idempotent, so this is safe to press twice.
      if (!status.connected) setStatus(await apiClient.createHostPaymentAccount());

      const link = await apiClient.createHostOnboardingLink();
      window.location.href = link.url;
    } catch {
      showToast("Nie udało się otworzyć konfiguracji płatności.");
      setPending(false);
    }
  }

  async function refresh() {
    setPending(true);
    try {
      setStatus(await apiClient.getHostPaymentStatus());
    } catch {
      showToast("Nie udało się odświeżyć stanu konta.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-6 rounded-[14px] border border-line bg-surface p-6">
      <Icon
        size={26}
        strokeWidth={2.2}
        aria-hidden="true"
        className={copy.tone === "ok" ? "text-success" : "text-brand"}
      />

      <h2 className="mt-3 text-[20px] font-bold tracking-tight">{copy.title}</h2>
      <p className="mt-2 max-w-[56ch] text-[15px] text-muted">{copy.description}</p>

      <dl className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 text-[14px] sm:grid-cols-3">
        <Flag label="Przyjmowanie płatności" on={status.chargesEnabled} />
        <Flag label="Wypłaty" on={status.payoutsEnabled} />
        <Flag label="Dane uzupełnione" on={status.detailsSubmitted} />
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        {copy.cta ? (
          <Button variant="accent" size="md" disabled={pending} onClick={configure}>
            <ExternalLink size={16} strokeWidth={2.4} />
            {pending ? "Otwieram…" : copy.cta}
          </Button>
        ) : null}
        <Button variant="outline" size="md" disabled={pending} onClick={refresh}>
          Odśwież stan
        </Button>
      </div>

      <p className="mt-5 text-[13px] text-muted">
        Rozliczenia i wypłaty za zakończone pobyty pojawią się w kolejnym etapie.
      </p>
    </section>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold">{on ? "tak" : "nie"}</dd>
    </div>
  );
}
