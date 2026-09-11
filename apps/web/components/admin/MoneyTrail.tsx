import type { AdminBookingDetail } from "@rezervio/api-client";

import { StatePill } from "@/components/admin/StatusPill";
import { formatInstant, formatMinor } from "@/lib/admin";

/**
 * The five stages money passes through, in order.
 *
 * ```text
 * Payment    Guest              → Rezervio
 * Refund     Rezervio           → Guest
 * Settlement how much the Host is owed, and from when
 * Transfer   platform balance   → connected account
 * Payout     connected account  → Host bank
 * ```
 *
 * Laid out as a column of stages rather than a table, because the question is
 * always "which stage stopped" and a stage that has not happened yet is
 * information too (milestone 11 §7).
 */
export function MoneyTrail({ booking }: { booking: AdminBookingDetail }) {
  const { payment, refunds, settlement, payouts } = booking;

  return (
    <div className="divide-y divide-line/60">
      <Stage
        title="Płatność"
        subtitle="Gość → Rezervio. Potwierdza wyłącznie zweryfikowany webhook."
        status={payment?.status ?? null}
        empty="Płatność nie została jeszcze rozpoczęta."
      >
        {payment ? (
          <dl className="grid gap-3 sm:grid-cols-4">
            <Cell label="Kwota">{formatMinor(payment.amountMinor, payment.currency)}</Cell>
            <Cell label="Prowizja">
              {formatMinor(payment.platformFeeAmountMinor, payment.currency)}
            </Cell>
            <Cell label="Identyfikator u dostawcy">
              <code className="text-[13px]">{payment.providerPaymentId ?? "—"}</code>
            </Cell>
            <Cell label="Powodzenie">{formatInstant(payment.succeededAt)}</Cell>
            {payment.failureCode ? (
              <Cell label="Kod błędu">{payment.failureCode}</Cell>
            ) : null}
          </dl>
        ) : null}
      </Stage>

      <Stage
        title="Zwroty"
        subtitle="Dokładnie jeden zwrot na płatność i powód — pilnuje tego unikalny indeks."
        status={refunds[0]?.status ?? null}
        empty="Brak zwrotów."
      >
        {refunds.length > 0 ? (
          <ul className="space-y-2">
            {refunds.map((refund) => (
              <li key={refund.id} className="flex flex-wrap items-center gap-3">
                <StatePill status={refund.status} />
                <span className="text-[14px] font-bold">
                  {formatMinor(refund.amountMinor, refund.currency)}
                </span>
                <span className="text-[14px] text-muted">{refund.reason}</span>
                <code className="text-[13px] text-muted">{refund.providerRefundId ?? "—"}</code>
                {refund.failureCode ? (
                  <span className="text-[13px] text-muted">· {refund.failureCode}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Stage>

      <Stage
        title="Rozliczenie"
        subtitle="Ile należy się gospodarzowi i od kiedy. Kwoty ze snapshotu rezerwacji, nigdy przeliczane."
        status={settlement?.status ?? null}
        empty="Rozliczenie jeszcze nie powstało — powstaje po udanej płatności."
      >
        {settlement ? (
          <dl className="grid gap-3 sm:grid-cols-4">
            <Cell label="Brutto">
              {formatMinor(settlement.grossAmountMinor, settlement.currency)}
            </Cell>
            <Cell label="Prowizja">
              {formatMinor(settlement.platformFeeMinor, settlement.currency)}
            </Cell>
            <Cell label="Dla gospodarza">
              {formatMinor(settlement.hostAmountMinor, settlement.currency)}
            </Cell>
            <Cell label="Zwolnienie">{formatInstant(settlement.releaseAt)}</Cell>
            {settlement.failureCode ? (
              <Cell label="Kod błędu">{settlement.failureCode}</Cell>
            ) : null}
          </dl>
        ) : null}
      </Stage>

      <Stage
        title="Przelew"
        subtitle="Saldo platformy → konto Connect gospodarza. Najwyżej jeden żywy przelew na rozliczenie."
        status={settlement?.transfers[0]?.status ?? null}
        empty="Żaden przelew jeszcze nie powstał."
      >
        {settlement && settlement.transfers.length > 0 ? (
          <ul className="space-y-2">
            {settlement.transfers.map((transfer) => (
              <li key={transfer.id} className="flex flex-wrap items-center gap-3">
                <StatePill status={transfer.status} />
                <span className="text-[14px] font-bold">
                  {formatMinor(transfer.amountMinor, transfer.currency)}
                </span>
                <code className="text-[13px] text-muted">
                  {transfer.providerTransferId ?? "—"}
                </code>
                <span className="text-[13px] text-muted">
                  {formatInstant(transfer.createdAt)}
                  {transfer.failureCode ? ` · ${transfer.failureCode}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Stage>

      <Stage
        title="Wypłaty gospodarza"
        subtitle="Konto Connect → bank. Wykonuje je dostawca według harmonogramu konta; Rezervio je obserwuje."
        status={payouts[0]?.status ?? null}
        empty="Brak zaobserwowanych wypłat."
      >
        {payouts.length > 0 ? (
          <ul className="space-y-2">
            {payouts.map((payout) => (
              <li key={payout.id} className="flex flex-wrap items-center gap-3">
                <StatePill status={payout.status} />
                <span className="text-[14px] font-bold">
                  {formatMinor(payout.amountMinor, payout.currency)}
                </span>
                <span className="text-[13px] text-muted">
                  {payout.arrivalAt ? `na koncie ${formatInstant(payout.arrivalAt)}` : "—"}
                  {payout.failureCode ? ` · ${payout.failureCode}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Stage>
    </div>
  );
}

function Stage({
  title,
  subtitle,
  status,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  status: string | null;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[15px] font-bold">{title}</h3>
        <StatePill status={status} />
      </div>
      <p className="mt-1 max-w-[80ch] text-[13px] text-muted">{subtitle}</p>
      <div className="mt-3">
        {children ?? <p className="text-[14px] text-muted">{empty}</p>}
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-bold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-[14px]">{children}</dd>
    </div>
  );
}
