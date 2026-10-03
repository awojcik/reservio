import { cn } from "@/lib/cn";
import { STATUS_LABELS } from "@/lib/host";

/** Status is never colour alone — the label always carries the meaning. */
const TONES: Record<string, string> = {
  PUBLISHED: "border-success/35 bg-success/12 text-success",
  DRAFT: "border-line bg-background text-muted",
  IN_REVIEW: "border-line bg-background text-muted",
  SUSPENDED: "border-accent-edge/35 bg-accent/12 text-ink",
  ARCHIVED: "border-line bg-background text-muted",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-bold",
        TONES[status] ?? TONES.DRAFT,
        className,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
