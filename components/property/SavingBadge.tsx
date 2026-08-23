import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";

type SavingBadgeProps = {
  saving: number;
  size?: "sm" | "md";
  className?: string;
};

/**
 * The lime badge is reserved for exactly this: money the guest does not pay.
 * Nothing else in the product uses --highlight.
 */
export function SavingBadge({ saving, size = "sm", className }: SavingBadgeProps) {
  if (saving <= 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[6px] bg-highlight font-extrabold text-ink uppercase",
        size === "sm"
          ? "px-2 py-1 text-[11px] tracking-[0.06em]"
          : "px-3 py-1.5 text-[13px] tracking-[0.05em]",
        className,
      )}
    >
      Oszczędzasz {formatPrice(saving)}
    </span>
  );
}
