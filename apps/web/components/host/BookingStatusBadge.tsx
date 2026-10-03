import { cn } from "@/lib/cn";
import { BOOKING_STATUS_LABELS } from "@/lib/booking";

/** Status is never colour alone — the label always carries the meaning. */
const TONES: Record<string, string> = {
  PENDING_HOST_APPROVAL: "border-accent-edge/35 bg-accent/12 text-ink",
  PENDING_PAYMENT: "border-brand/30 bg-brand/10 text-brand",
  CONFIRMED: "border-success/35 bg-success/12 text-success",
  CANCELLED: "border-line bg-background text-muted",
  EXPIRED: "border-line bg-background text-muted",
  COMPLETED: "border-line bg-background text-muted",
};

export function BookingStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-bold",
        TONES[status] ?? TONES.CANCELLED,
      )}
    >
      {BOOKING_STATUS_LABELS[status] ?? status}
    </span>
  );
}
