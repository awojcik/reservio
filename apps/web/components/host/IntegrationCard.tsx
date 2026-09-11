"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type HostIntegration } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  PROVIDER_DESCRIPTIONS,
  PROVIDER_LABELS,
  STATUS_LABELS,
  STATUS_REASON_LABELS,
  SYNC_TYPE_LABELS,
  formatSyncTime,
  severityOfConnection,
} from "@/lib/integrations";

const TONES = {
  OK: "border-success/35 bg-success/12 text-success",
  PENDING: "border-line bg-background text-muted",
  WARNING: "border-accent-edge/35 bg-accent/12 text-ink",
  FAILED: "border-accent-edge bg-accent/20 text-ink",
} as const;

/**
 * One provider, its state and what a Host can do about it.
 *
 * A provider that needs partner access shows what is missing instead of a
 * Connect button that could not work. Offering the button anyway would be a
 * promise the deployment cannot keep (milestone 12 §21, §22).
 */
export function IntegrationCard({ integration }: { integration: HostIntegration }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const severity = severityOfConnection(integration.status);
  const connected = integration.id !== null && integration.status !== "DISCONNECTED";

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      showToast(await action());
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się wykonać operacji.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-bold tracking-tightest">
              {PROVIDER_LABELS[integration.provider] ?? integration.provider}
            </h2>
            <span
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-bold",
                TONES[severity],
              )}
            >
              {STATUS_LABELS[integration.status] ?? integration.status}
            </span>
          </div>
          <p className="mt-1 max-w-[70ch] text-[14px] text-muted">
            {PROVIDER_DESCRIPTIONS[integration.provider]}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {integration.available && !connected && integration.provider === "HOSTAWAY" ? (
            <Link
              href="/host/integrations/hostaway"
              className="inline-flex h-9 items-center rounded-control border border-brand bg-brand px-3.5 text-[13px] font-bold text-surface"
            >
              Połącz Hostaway
            </Link>
          ) : null}

          {connected ? (
            <>
              <Link
                href={`/host/integrations/${integration.id}`}
                className="inline-flex h-9 items-center rounded-control border border-brand px-3.5 text-[13px] font-bold text-brand"
              >
                Mapowania
              </Link>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await apiClient.syncIntegration(integration.id!);
                    return result.queued
                      ? "Synchronizacja trafiła do kolejki."
                      : "Synchronizacja jest już zaplanowana — nie dodano drugiej.";
                  })
                }
              >
                Synchronizuj teraz
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await apiClient.disconnectIntegration(integration.id!);
                    return "Rozłączono. Mapowania i blokady zostały zachowane.";
                  })
                }
              >
                Rozłącz
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {integration.statusReason ? (
        <p
          className={cn(
            "mt-4 rounded-control border px-3 py-2 text-[14px]",
            integration.statusReason === "PARTNER_ACCESS_REQUIRED"
              ? "border-line bg-background text-muted"
              : "border-accent-edge/35 bg-accent/12 text-ink",
          )}
        >
          {STATUS_REASON_LABELS[integration.statusReason] ?? integration.statusReason}
        </p>
      ) : null}

      {connected ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Konto u dostawcy">{integration.externalAccountId ?? "—"}</Field>
          <Field label="Zmapowane obiekty">{integration.mappedProperties}</Field>
          <Field label="Ostatnia udana synchronizacja">
            {formatSyncTime(integration.lastSuccessfulSyncAt)}
          </Field>
          <Field label="Ostatni błąd">
            {integration.lastErrorCode ?? "—"}
            {integration.lastFailedSyncAt ? (
              <span className="block text-[13px] text-muted">
                {formatSyncTime(integration.lastFailedSyncAt)}
              </span>
            ) : null}
          </Field>
        </dl>
      ) : null}

      {integration.webhookUrl ? (
        <div className="mt-4 rounded-control border border-line bg-background px-3 py-2">
          <p className="text-[12px] font-bold tracking-wide text-muted uppercase">
            Adres webhooka
          </p>
          <code className="mt-1 block text-[13px] break-all">{integration.webhookUrl}</code>
          <p className="mt-1 text-[13px] text-muted">
            Wklej go w panelu dostawcy razem z hasłem pokazanym przy łączeniu. Hasła nie da
            się odczytać później — po zgubieniu połącz ponownie.
          </p>
        </div>
      ) : null}

      {integration.recentSyncs.length > 0 ? (
        <ul className="mt-4 divide-y divide-line/60 rounded-control border border-line">
          {integration.recentSyncs.map((attempt, index) => (
            <li
              key={`${attempt.startedAt}-${index}`}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]"
            >
              <span className="font-bold">
                {SYNC_TYPE_LABELS[attempt.syncType] ?? attempt.syncType}
              </span>
              <span className={attempt.status === "FAILED" ? "text-ink" : "text-muted"}>
                {attempt.status}
                {attempt.errorCode ? ` · ${attempt.errorCode}` : ""}
              </span>
              <span className="ml-auto text-muted">
                {attempt.itemsProcessed} przetworzonych, {attempt.itemsFailed} nieudanych ·{" "}
                {formatSyncTime(attempt.startedAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-bold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{children}</dd>
    </div>
  );
}
