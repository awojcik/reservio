"use client";

import { Banknote, Clock, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { HostFinanceSummary, Settlement } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatAmountMinor, formatLongDateRange } from "@/lib/format";
import { PAYOUT_STATUS_LABELS, SETTLEMENT_STATUS_LABELS } from "@/lib/settlement";

/**
 * The Host's money in business terms.
 *
 * Four different things are kept apart here on purpose: what the Guest paid,
 * what Rezervio keeps, what the Host is owed, and where that money currently
 * sits. Provider object ids are not a Host's problem (milestone 10 §25).
 */
export function FinanceOverview({
  initialSummary,
  initialSettlements,
}: {
  initialSummary: HostFinanceSummary;
  initialSettlements: Settlement[];
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [summary, setSummary] = useState(initialSummary);
  const [settlements, setSettlements] = useState(initialSettlements);
  const [releasing, setReleasing] = useState<string | null>(null);

  async function releaseNow(settlementId: string) {
    setReleasing(settlementId);
    try {
      await apiClient.releaseSettlementNow(settlementId);
      const [freshSummary, freshList] = await Promise.all([
        apiClient.getHostFinanceSummary(),
        apiClient.listHostSettlements({ limit: 25 }),
      ]);
      setSummary(freshSummary);
      setSettlements(freshList.items);
      showToast("Środki zwolnione.");
      router.refresh();
    } catch {
      showToast("Nie udało się zwolnić środków.");
    } finally {
      setReleasing(null);
    }
  }

  const { balance } = summary;

  return (
    <>
      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Amount
          icon={<Clock size={17} strokeWidth={2.3} />}
          label="Do wypłaty później"
          hint="zarobione, czeka na termin zwolnienia"
          amountMinor={balance.pendingMinor}
        />
        <Amount
          icon={<Wallet size={17} strokeWidth={2.3} />}
          label="Dostępne"
          hint="gotowe do przekazania"
          amountMinor={balance.availableMinor}
        />
        <Amount
          icon={<Banknote size={17} strokeWidth={2.3} />}
          label="Przekazane"
          hint="na Twoje konto rozliczeniowe"
          amountMinor={balance.transferredMinor}
        />
      </dl>

      {!summary.payoutsReady ? (
        <p className="mt-4 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-4 py-3 text-[14px] font-semibold">
          Dokończ konfigurację płatności, aby otrzymać środki. Zarobione pieniądze czekają
          — nic nie przepada.
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-[20px] font-bold tracking-tight">Rozliczenia</h2>

        {settlements.length === 0 ? (
          <p className="mt-4 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
            Nie masz jeszcze rozliczeń. Pojawią się po opłaconych rezerwacjach.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {settlements.map((settlement) => (
              <li
                key={settlement.id}
                className="rounded-[14px] border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={settlement.status} />
                      <span className="text-[12px] font-bold text-muted tabular-nums">
                        {settlement.bookingReference}
                      </span>
                    </div>

                    <h3 className="mt-1.5 truncate text-[16px] font-bold tracking-tight">
                      {settlement.propertyTitle}
                    </h3>
                    <p className="mt-0.5 text-[14px] text-muted">
                      {formatLongDateRange(settlement.checkIn, settlement.checkOut)}
                    </p>

                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                      <Line label="Gość zapłacił" amountMinor={settlement.grossAmountMinor} />
                      <Line label="Prowizja Rezervio" amountMinor={settlement.platformFeeMinor} />
                      <Line label="Dla Ciebie" amountMinor={settlement.hostAmountMinor} strong />
                    </dl>

                    <p className="mt-1.5 text-[13px] text-muted">
                      {settlement.transferredAt
                        ? `Przekazane ${date(settlement.transferredAt)}`
                        : `Środki zwolnią się ${date(settlement.releaseAt)}`}
                    </p>
                  </div>

                  {settlement.canReleaseNow ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={releasing !== null}
                      onClick={() => releaseNow(settlement.id)}
                    >
                      {releasing === settlement.id
                        ? "Zwalniam…"
                        : "Zwolnij środki teraz — sandbox"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary.recentPayouts.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-[20px] font-bold tracking-tight">Wypłaty na konto bankowe</h2>
          <p className="mt-1 text-[14px] text-muted">
            Wykonuje je operator płatności według harmonogramu Twojego konta.
          </p>

          <ul className="mt-4 space-y-2">
            {summary.recentPayouts.map((payout) => (
              <li
                key={payout.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-[15px] font-bold tabular-nums">
                    {formatAmountMinor(payout.amountMinor)}
                  </p>
                  <p className="text-[13px] text-muted">
                    {PAYOUT_STATUS_LABELS[payout.status] ?? payout.status}
                    {payout.arrivalAt ? ` · na koncie ${date(payout.arrivalAt)}` : ""}
                  </p>
                </div>
                {payout.failureMessage ? (
                  <p className="text-[13px] font-semibold text-accent-edge">
                    {payout.failureMessage}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Amount({
  icon,
  label,
  hint,
  amountMinor,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  hint: string;
  amountMinor: number;
}>) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4">
      <dt className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        <span aria-hidden="true" className="text-brand">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="mt-1.5 text-[26px] leading-none font-bold tabular-nums">
        {formatAmountMinor(amountMinor)}
      </dd>
      <p className="mt-1.5 text-[12px] text-muted">{hint}</p>
    </div>
  );
}

function Line({
  label,
  amountMinor,
  strong = false,
}: {
  label: string;
  amountMinor: number;
  strong?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-bold" : "font-semibold")}>
        {formatAmountMinor(amountMinor)}
      </dd>
    </div>
  );
}

/** Status is carried by the label, not by colour alone. */
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "TRANSFERRED"
      ? "border-success/35 bg-success/12 text-success"
      : status === "CANCELLED" || status === "REVERSED"
        ? "border-line bg-background text-muted"
        : status === "AVAILABLE"
          ? "border-accent-edge/35 bg-accent/12 text-ink"
          : "border-brand/30 bg-brand/10 text-brand";

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-bold",
        tone,
      )}
    >
      {SETTLEMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function date(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "long" }).format(new Date(iso));
}
