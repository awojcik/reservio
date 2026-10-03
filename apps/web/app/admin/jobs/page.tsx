import type { Metadata } from "next";

import { RetryJobButton } from "@/components/admin/RetryJobButton";
import { Section } from "@/components/admin/Section";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Zadania — admin" };

/**
 * The job registry, and what has given up.
 *
 * A job that exhausted its attempts is otherwise invisible: BullMQ keeps it in
 * a failed set nobody looks at, and the email or transfer it stood for simply
 * never happens. Making that set visible is most of what "operable" means
 * (milestone 11 §31, §32).
 */
export default async function AdminJobsPage() {
  const client = await createSessionApiClient();
  const jobs = await client.getAdminJobs({ cache: "no-store" });

  const unreachable = jobs.queues.filter((queue) => !queue.reachable);

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Kolejki i zadania
      </h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Redis trzyma zadania, nigdy odpowiedzi. Utracone zadanie kosztuje opóźnienie —
        poprawność stanu pilnuje PostgreSQL.
      </p>

      {unreachable.length > 0 ? (
        <p className="mt-4 rounded-card border border-accent-edge bg-accent/12 px-4 py-3 text-[14px] font-bold text-ink">
          Redis nie odpowiada dla: {unreachable.map((queue) => queue.name).join(", ")}.
        </p>
      ) : null}

      <Section title="Rejestr kolejek" description="Wszystkie typy zadań, jakie uruchamia Rezervio.">
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] font-bold tracking-wide text-muted uppercase">
                <th className="py-2 pr-3">Kolejka</th>
                <th className="py-2 pr-3">Typy zadań</th>
                <th className="py-2 pr-3">Czeka</th>
                <th className="py-2 pr-3">W toku</th>
                <th className="py-2 pr-3">Opóźnione</th>
                <th className="py-2 pr-3">Nieudane</th>
                <th className="py-2">Stan</th>
              </tr>
            </thead>
            <tbody>
              {jobs.queues.map((queue) => (
                <tr key={queue.name} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-3 font-bold">{queue.name}</td>
                  <td className="py-2.5 pr-3 text-[13px] text-muted">
                    {queue.jobTypes.join(", ")}
                  </td>
                  <td className="py-2.5 pr-3">{queue.waiting}</td>
                  <td className="py-2.5 pr-3">{queue.active}</td>
                  <td className="py-2.5 pr-3">{queue.delayed}</td>
                  <td className="py-2.5 pr-3 font-bold">{queue.failed}</td>
                  <td className="py-2.5">
                    <StatusPill
                      label={queue.reachable ? "OK" : "Redis nie odpowiada"}
                      severity={queue.reachable ? (queue.failed > 0 ? "WARNING" : "OK") : "FAILED"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Nieudane zadania"
        description="Zadania, które wyczerpały ponowienia. Ponowienie uruchamia ten sam handler z tym samym payloadem."
      >
        {jobs.failed.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Żadne zadanie nie zawiodło ostatecznie.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {jobs.failed.map((job) => (
              <li
                key={`${job.queue}:${job.id}`}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-bold">
                    {job.queue} · {job.name} · #{job.id}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    {job.attemptsMade} prób · {formatInstant(job.failedAt)}
                  </p>
                  {job.failedReason ? (
                    <p className="mt-1 max-w-[80ch] text-[13px] text-muted">{job.failedReason}</p>
                  ) : null}
                  <p className="mt-1 text-[13px] text-muted">
                    <code>{JSON.stringify(job.data)}</code>
                  </p>
                </div>
                <RetryJobButton queue={job.queue} jobId={job.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
