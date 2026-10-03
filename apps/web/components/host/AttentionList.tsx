import { AlertTriangle, ArrowRight, Info, Zap } from "lucide-react";
import Link from "next/link";

import type { AttentionItem, AttentionSeverity } from "@rezervio/api-client";

import { cn } from "@/lib/cn";
import {
  SEVERITY_LABELS,
  SEVERITY_TONES,
  formatTimeRemaining,
} from "@/lib/host-operations";

const ICONS = { ACTION: Zap, WARNING: AlertTriangle, INFO: Info };

/**
 * The first thing a Host sees. Severity is carried by the label and the icon,
 * not by colour alone (milestone 07 §15, §31).
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="mt-4 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-8 text-center text-[15px] text-muted">
        Nic nie czeka na Twoją reakcję. Wszystko pod kontrolą.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((item) => {
        const severity = item.severity as AttentionSeverity;
        const Icon = ICONS[severity] ?? Info;

        return (
          <li key={`${item.type}-${item.bookingId ?? item.propertyId ?? item.occurredAt}`}>
            <Link
              href={item.actionUrl}
              className={cn(
                "group flex items-start gap-3 rounded-[14px] border px-4 py-3.5 transition-colors hover:border-ink/30",
                SEVERITY_TONES[severity] ?? SEVERITY_TONES.INFO,
              )}
            >
              <Icon
                size={18}
                strokeWidth={2.5}
                aria-hidden="true"
                className={cn(
                  "mt-0.5 shrink-0",
                  severity === "ACTION" ? "text-accent-edge" : "text-brand",
                )}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[16px] font-bold tracking-tight">{item.title}</span>
                  <span className="text-[12px] font-bold text-muted uppercase">
                    {SEVERITY_LABELS[severity]}
                  </span>
                </div>
                <p className="mt-0.5 text-[14px] text-muted">{item.description}</p>
                {item.deadlineAt ? (
                  <p className="mt-0.5 text-[13px] font-semibold text-accent-edge">
                    {formatTimeRemaining(item.deadlineAt)}
                  </p>
                ) : null}
              </div>

              <ArrowRight
                size={17}
                strokeWidth={2.4}
                aria-hidden="true"
                className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
