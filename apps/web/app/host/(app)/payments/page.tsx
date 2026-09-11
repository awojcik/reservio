import type { Metadata } from "next";

import { FinanceOverview } from "@/components/host/FinanceOverview";
import { PaymentAccountPanel } from "@/components/host/PaymentAccountPanel";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Płatności" };

/**
 * Whether this Host can be paid. Balances, transfers and payouts are a later
 * milestone — half a payout system would be worse than none.
 */
export default async function HostPaymentsPage() {
  const client = await createSessionApiClient();
  const [status, summary, settlements] = await Promise.all([
    client.getHostPaymentStatus({ cache: "no-store" }),
    client.getHostFinanceSummary({ cache: "no-store" }),
    client.listHostSettlements({ limit: 25 }, { cache: "no-store" }),
  ]);

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Płatności</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Twoje finanse
      </h1>
      <p className="mt-3 max-w-[58ch] text-[16px] text-muted">
        Ile zarobiłeś, kiedy środki się zwolnią i gdzie właśnie są. Płatności obsługuje
        zewnętrzny operator — dane weryfikacyjne i numer konta podajesz bezpośrednio
        u niego.
      </p>

      <FinanceOverview initialSummary={summary} initialSettlements={settlements.items} />

      <div className="mt-10 border-t border-line pt-8">
        <PaymentAccountPanel initial={status} />
      </div>
    </div>
  );
}
