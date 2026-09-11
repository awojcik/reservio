import type { Metadata } from "next";
import Link from "next/link";

import { IssueList } from "@/components/admin/IssueList";
import { Pagination } from "@/components/admin/Pagination";
import { ReconcileButton } from "@/components/admin/ReconcileButton";
import { Field, Section } from "@/components/admin/Section";
import { StatusPill } from "@/components/admin/StatusPill";
import { CATEGORY_LABELS, formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Operacje — admin" };

const PAGE_SIZE = 50;

const CATEGORIES = [
  "PAYMENT",
  "REFUND",
  "SETTLEMENT",
  "TRANSFER",
  "PAYOUT",
  "ICAL",
  "NOTIFICATION",
  "JOB",
  "WEBHOOK",
];

/**
 * Financial operations and everything else that is currently stuck.
 *
 * A read model, not a list somebody maintains: an issue exists exactly as long
 * as its cause does, so nothing has to be closed by hand and nothing goes
 * stale (milestone 11 §12).
 */
export default async function AdminOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; severity?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const client = await createSessionApiClient();
  const [issues, reconciliation] = await Promise.all([
    client.listOperationalIssues(
      {
        category: params.category || undefined,
        severity: params.severity || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
      { cache: "no-store" },
    ),
    client.getReconciliationStatus({ cache: "no-store" }),
  ]);

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Operacje finansowe i pipeline
      </h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Każdy wiersz jest wyliczony z tabel, które zapisuje domena. Akcje przy problemach
        uruchamiają istniejące komendy — nie ustawiają statusów.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Kategorie problemów">
        <FilterLink label="Wszystkie" href="/admin/operations" active={!params.category} />
        {CATEGORIES.map((category) => (
          <FilterLink
            key={category}
            label={CATEGORY_LABELS[category] ?? category}
            href={`/admin/operations?category=${category}`}
            active={params.category === category}
          />
        ))}
        <FilterLink
          label="Tylko błędy"
          href="/admin/operations?severity=FAILED"
          active={params.severity === "FAILED"}
        />
      </nav>

      {issues.counts.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {issues.counts.map((count) => (
            <StatusPill
              key={count.category}
              label={`${CATEGORY_LABELS[count.category] ?? count.category} · ${count.total} (${count.failed} błędów)`}
              severity={count.failed > 0 ? "FAILED" : "WARNING"}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <IssueList issues={issues.items} />
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={issues.total} />

      <Section
        title="Rekoncyliacja"
        description="Zwalnia należne rozliczenia, dopytuje dostawcę o zawieszone przelewy, ponawia nieudane i odczytuje wypłaty."
        action={<ReconcileButton />}
      >
        <dl className="grid gap-4 p-4 sm:grid-cols-4">
          <Field label="Ostatni przebieg">{formatInstant(reconciliation.lastRunAt)}</Field>
          <Field label="Uruchomił">{reconciliation.lastRunBy ?? "harmonogram"}</Field>
          <Field label="Wynik">{reconciliation.lastRunStatus ?? "—"}</Field>
          <Field label="Automatycznie co">{reconciliation.intervalMinutes} min</Field>
          <Field label="Zwolnione">{reconciliation.released}</Field>
          <Field label="Przelewy uzgodnione">{reconciliation.transfersRepaired}</Field>
          <Field label="Przelewy ponowione">{reconciliation.transfersRetried}</Field>
          <Field label="Cofnięcia ponowione">{reconciliation.reversalsRetried}</Field>
          <Field label="Wypłaty odczytane">{reconciliation.payoutsObserved}</Field>
          <Field label="Nierozwiązane rozbieżności">{reconciliation.openMismatches}</Field>
        </dl>
      </Section>
    </div>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex h-9 items-center rounded-full border border-brand bg-brand px-3.5 text-[13px] font-bold text-surface"
          : "inline-flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-bold transition-colors hover:border-brand"
      }
    >
      {label}
    </Link>
  );
}
