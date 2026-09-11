"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { OperationalIssue } from "@rezervio/api-client";
import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/admin/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { ACTION_LABELS, CATEGORY_LABELS, formatInstant } from "@/lib/admin";
import { apiClient } from "@/lib/api";

/**
 * Issues, with the safe actions that can address them.
 *
 * The list of actions comes from the backend with each issue, so the panel can
 * never offer something the API would refuse — and adding an issue type is one
 * edit on the server, not two (milestone 11 §10).
 */
export function IssueList({ issues }: { issues: OperationalIssue[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [running, setRunning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run(issue: OperationalIssue, action: string) {
    setRunning(`${issue.targetId}:${action}`);

    try {
      const result = await perform(action, issue);
      showToast(result);
      // The issue disappears when its cause does; re-read rather than guess.
      startTransition(() => router.refresh());
    } catch (error) {
      showToast(messageFor(error));
    } finally {
      setRunning(null);
    }
  }

  if (issues.length === 0) {
    return (
      <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-[15px] text-muted">
        Nic nie wymaga uwagi.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li
          key={`${issue.type}:${issue.targetId}`}
          className="rounded-card border border-line bg-surface p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label={CATEGORY_LABELS[issue.category] ?? issue.category} severity={issue.severity} />
                <span className="text-[15px] font-bold">{issue.title}</span>
              </div>
              <p className="mt-1 text-[14px] text-muted">
                {issue.description}
                {issue.errorCode ? ` · ${issue.errorCode}` : ""}
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {formatInstant(issue.occurredAt)}
                {issue.bookingId ? (
                  <>
                    {" · "}
                    <Link
                      href={`/admin/bookings/${issue.bookingId}`}
                      className="font-bold text-brand underline underline-offset-2"
                    >
                      {issue.bookingReference ?? "rezerwacja"}
                    </Link>
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {issue.actions.map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  size="sm"
                  disabled={running !== null}
                  onClick={() => run(issue, action)}
                >
                  {running === `${issue.targetId}:${action}`
                    ? "Uruchamiam…"
                    : (ACTION_LABELS[action] ?? action)}
                </Button>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Maps an action name onto the endpoint that runs the domain command.
 *
 * Every branch below is a retry or a reconciliation. There is deliberately no
 * branch that writes a status (milestone 11 §9).
 */
async function perform(action: string, issue: OperationalIssue): Promise<string> {
  switch (action) {
    case "RETRY_NOTIFICATION":
      return (await apiClient.retryNotification(issue.targetId)).summary;
    case "RETRY_REFUND":
      return (await apiClient.retryRefund(issue.targetId)).summary;
    case "RETRY_TRANSFER":
      // The command takes the Settlement; for a failed Transfer the backend
      // says which one in `actionTargetId`.
      return (await apiClient.retryTransfer(issue.actionTargetId)).summary;
    case "ICAL_RESYNC":
      return (await apiClient.resyncCalendar(issue.targetId)).summary;
    case "REFRESH_CONNECT_STATUS":
      return (await apiClient.refreshConnectStatus(issue.hostId!)).summary;
    case "RECONCILE":
      return (await apiClient.runReconciliation("all")).summary;
    default:
      throw new Error(`Nieznana akcja: ${action}`);
  }
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: string; code?: string } | undefined;
    return body?.message ?? `Nie udało się (${error.status}).`;
  }
  return "Nie udało się uruchomić akcji.";
}
