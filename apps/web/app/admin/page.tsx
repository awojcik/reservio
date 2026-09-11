import type { Metadata } from "next";
import Link from "next/link";

import { AdminSearchBox } from "@/components/admin/AdminSearchBox";
import { BookingsTable } from "@/components/admin/BookingsTable";
import { IssueList } from "@/components/admin/IssueList";
import { ReconcileButton } from "@/components/admin/ReconcileButton";
import { Field, Section } from "@/components/admin/Section";
import { StatusPill } from "@/components/admin/StatusPill";
import { CATEGORY_LABELS, formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Pulpit — admin" };

/**
 * The panel's front page.
 *
 * Deliberately not a BI dashboard: what is broken, what happened recently, and
 * whether reconciliation ran. One request answers all of it — the API does the
 * fan-out in parallel rather than the browser doing it in series
 * (milestone 11 §5).
 */
export default async function AdminDashboardPage() {
  const client = await createSessionApiClient();
  const dashboard = await client.getAdminDashboard({ cache: "no-store" });

  const totalIssues = dashboard.issueCounts.reduce((sum, count) => sum + count.total, 0);
  const failedJobs = dashboard.failedJobs.reduce((sum, queue) => sum + queue.failed, 0);
  const unreachable = dashboard.failedJobs.filter((queue) => !queue.reachable);

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Pulpit administracyjny
      </h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Wszystko, co teraz nie działa, i bezpieczne akcje, które można na to uruchomić.
        Panel nigdy nie ustawia stanów domenowych — ponawia istniejące komendy.
      </p>

      <div className="mt-6 max-w-[720px]">
        <AdminSearchBox />
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Problemy operacyjne" value={String(totalIssues)} href="/admin/operations" />
        <Tile label="Nieudane zadania" value={String(failedJobs)} href="/admin/jobs" />
        <Tile
          label="Nierozwiązane rozbieżności"
          value={String(dashboard.reconciliation.openMismatches)}
          href="/admin/operations"
        />
        <Tile
          label="Konta Connect gotowe"
          value={`${dashboard.stripe.connectReadyHosts} / ${
            dashboard.stripe.connectReadyHosts + dashboard.stripe.connectPendingHosts
          }`}
        />
      </div>

      {unreachable.length > 0 ? (
        <p className="mt-4 rounded-card border border-accent-edge bg-accent/12 px-4 py-3 text-[14px] font-bold text-ink">
          Redis nie odpowiada dla kolejek: {unreachable.map((queue) => queue.queue).join(", ")}.
          Zadania w tle nie są w tej chwili wykonywane.
        </p>
      ) : null}

      <Section
        title="Problemy operacyjne"
        description="Read model nad istniejącymi tabelami — problem znika, gdy znika jego przyczyna."
        action={
          <Link
            href="/admin/operations"
            className="text-[14px] font-bold text-brand underline underline-offset-4"
          >
            Wszystkie
          </Link>
        }
      >
        <div className="p-4">
          {dashboard.issueCounts.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {dashboard.issueCounts.map((count) => (
                <StatusPill
                  key={count.category}
                  label={`${CATEGORY_LABELS[count.category] ?? count.category} · ${count.total}`}
                  severity={count.failed > 0 ? "FAILED" : "WARNING"}
                />
              ))}
            </div>
          ) : null}

          <IssueList issues={dashboard.topIssues} />
        </div>
      </Section>

      <Section
        title="Rekoncyliacja"
        description="Ten sam przebieg, który chodzi automatycznie."
        action={<ReconcileButton />}
      >
        <dl className="grid gap-4 p-4 sm:grid-cols-4">
          <Field label="Ostatni przebieg">
            {formatInstant(dashboard.reconciliation.lastRunAt)}
          </Field>
          <Field label="Wynik">{dashboard.reconciliation.lastRunStatus ?? "—"}</Field>
          <Field label="Rozbieżności">{dashboard.reconciliation.openMismatches}</Field>
          <Field label="Automatycznie co">
            {dashboard.reconciliation.intervalMinutes} min
          </Field>
        </dl>
      </Section>

      <Section title="Ostatnie rezerwacje">
        <div className="p-4">
          <BookingsTable rows={dashboard.recentBookings} />
        </div>
      </Section>

      <Section
        title="Audyt akcji"
        description="Kto, co i kiedy uruchomił. Bez sekretów w metadanych."
      >
        <ul className="divide-y divide-line/60">
          {dashboard.recentActions.length === 0 ? (
            <li className="px-4 py-8 text-center text-[15px] text-muted">
              Nikt jeszcze nic nie uruchomił.
            </li>
          ) : (
            dashboard.recentActions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatusPill
                  label={action.status}
                  severity={action.status === "FAILED" ? "FAILED" : "OK"}
                />
                <span className="text-[14px] font-bold">{action.actionType}</span>
                <span className="text-[14px] text-muted">{action.summary ?? "—"}</span>
                <span className="ml-auto text-[13px] text-muted">
                  {action.adminEmail} · {formatInstant(action.createdAt)}
                </span>
              </li>
            ))
          )}
        </ul>
      </Section>
    </div>
  );
}

function Tile({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-[12px] font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-[26px] leading-none font-bold tracking-tightest">{value}</p>
    </div>
  );

  return href ? (
    <Link href={href} className="transition-colors hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}
