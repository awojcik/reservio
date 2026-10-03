import type { Metadata } from "next";
import Link from "next/link";

import { IntegrationActions } from "@/components/admin/IntegrationActions";
import { Pagination } from "@/components/admin/Pagination";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Integracje — admin" };

const PAGE_SIZE = 50;

const SEVERITY = {
  CONNECTED: "OK",
  PENDING: "PENDING",
  DEGRADED: "WARNING",
  DISCONNECTED: "FAILED",
  ACTION_REQUIRED: "FAILED",
} as const;

/**
 * Every connection across every Host.
 *
 * Worst first: a connection that needs attention is the reason anybody opens
 * this page. Credentials do not appear here in any form — not the ciphertext,
 * not a masked fragment (milestone 12 §25).
 */
export default async function AdminIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1) || 1);

  const client = await createSessionApiClient();
  const integrations = await client.listAdminIntegrations(
    { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    { cache: "no-store" },
  );

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Integracje z systemami gospodarzy
      </h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Rezervio pozostaje źródłem prawdy dla rezerwacji i ostatecznej dostępności.
        Zewnętrzny system dostarcza sygnały — akcje poniżej wyłącznie je ponawiają.
      </p>

      <div className="mt-6 rounded-card border border-line bg-surface">
        {integrations.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Żaden gospodarz nie podłączył jeszcze zewnętrznego systemu.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {integrations.items.map((integration) => (
              <li key={integration.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={integration.status}
                        severity={
                          SEVERITY[integration.status as keyof typeof SEVERITY] ?? "PENDING"
                        }
                      />
                      <span className="text-[15px] font-bold">{integration.provider}</span>
                      <Link
                        href={`/admin/hosts/${integration.hostId}`}
                        className="text-[14px] font-bold text-brand underline underline-offset-2"
                      >
                        {integration.hostDisplayName}
                      </Link>
                    </div>

                    <p className="mt-1 text-[14px] text-muted">
                      {integration.mappedProperties} zmapowanych obiektów ·{" "}
                      {integration.inboundReservations} rezerwacji przychodzących ·{" "}
                      {integration.pendingOutbound} oczekujących przekazań ·{" "}
                      {integration.failedSyncs} nieudanych synchronizacji (24 h) ·{" "}
                      {integration.unprocessedEvents} nieprzetworzonych zdarzeń
                    </p>

                    <p className="mt-1 text-[13px] text-muted">
                      Konto: {integration.externalAccountId ?? "—"} · ostatnia udana
                      synchronizacja {formatInstant(integration.lastSuccessfulSyncAt)}
                      {integration.statusReason ? ` · ${integration.statusReason}` : ""}
                      {integration.lastErrorCode ? ` · ${integration.lastErrorCode}` : ""}
                    </p>
                  </div>

                  <IntegrationActions
                    connectionId={integration.id}
                    disabled={integration.status === "DISCONNECTED"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={integrations.total} />
    </div>
  );
}
