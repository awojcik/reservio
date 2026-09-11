import type { Metadata } from "next";

import { IntegrationCard } from "@/components/host/IntegrationCard";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Integracje" };

/**
 * The Host's connections to external systems.
 *
 * Rezervio is meant to be an extra sales channel, not an extra calendar to
 * keep by hand — this is the page that makes that true (milestone 12 §2, §22).
 */
export default async function HostIntegrationsPage() {
  const client = await createSessionApiClient();
  const integrations = await client.getHostIntegrations({ cache: "no-store" });

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Integracje</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Twoje systemy
      </h1>
      <p className="mt-3 max-w-[62ch] text-[16px] text-muted">
        Podłącz system, w którym już prowadzisz kalendarz. Rezerwacje z innych kanałów
        zablokują terminy tutaj, a rezerwacje z Rezervio trafią tam — bez przepisywania
        dat ręcznie.
      </p>

      {integrations.icalAlsoConnected ? (
        <p className="mt-6 rounded-card border border-accent-edge/35 bg-accent/12 px-4 py-3 text-[14px] text-ink">
          Masz też kalendarze podpięte przez iCal. Jeśli to samo źródło jest podłączone
          dwoma drogami, ten sam termin przyjdzie dwa razy — raz jako anonimowa blokada,
          raz jako rezerwacja z identyfikatorem. Nic nie wyłączamy za Ciebie; decyzja,
          którą drogę zostawić, należy do Ciebie.
        </p>
      ) : null}

      <div className="mt-8 space-y-4">
        {integrations.items.map((integration) => (
          <IntegrationCard key={integration.provider} integration={integration} />
        ))}
      </div>
    </div>
  );
}
