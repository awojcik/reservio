import type { IssueSeverity } from "@rezervio/api-client";

import { cn } from "@/lib/cn";
import { SEVERITY_LABELS, SEVERITY_TONES, severityOfStatus } from "@/lib/admin";

/**
 * One badge for every state in the panel.
 *
 * The label always carries the meaning, so the colour is reinforcement rather
 * than information — the screen still works for somebody who cannot tell the
 * two reds apart (milestone 11 §37).
 */
export function StatusPill({
  label,
  severity,
  className,
}: {
  label: string;
  severity: IssueSeverity;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-bold whitespace-nowrap",
        SEVERITY_TONES[severity],
        className,
      )}
      title={SEVERITY_LABELS[severity]}
    >
      {label}
    </span>
  );
}

/** A domain status mapped onto the four-state scale. */
export function StatePill({ status }: { status: string | null | undefined }) {
  return <StatusPill label={status ?? "—"} severity={severityOfStatus(status)} />;
}
