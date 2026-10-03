"use client";

import { ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * Filter pill. Active state is coral border + coral wash + dark text —
 * never colour alone: active chips also carry their value in the label.
 */
export function chipStyles(active: boolean, className?: string): string {
  return cn(
    "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4",
    "text-[14px] font-bold whitespace-nowrap transition-colors duration-150",
    active
      ? "border-accent bg-accent/12 text-ink"
      : "border-line bg-surface text-ink hover:border-ink/35",
    className,
  );
}

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  /** Renders the little chevron used by chips that open a popover. */
  withChevron?: boolean;
};

export function Chip({
  active = false,
  withChevron = false,
  className,
  children,
  ...props
}: ChipProps) {
  return (
    <button type="button" className={chipStyles(active, className)} {...props}>
      {children}
      {withChevron ? (
        <ChevronDown size={15} strokeWidth={2.5} className="-mr-1 opacity-60" />
      ) : null}
    </button>
  );
}
