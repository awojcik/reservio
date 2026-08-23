import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "outline" | "ghost" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-surface border border-brand hover:bg-[#0d2e26] active:bg-[#0a241e]",
  outline:
    "bg-transparent text-brand border border-brand hover:bg-brand/5 active:bg-brand/10",
  ghost:
    "bg-transparent text-ink border border-transparent hover:bg-ink/5 active:bg-ink/10",
  accent:
    "bg-accent text-ink border border-[#e6412b] hover:bg-[#ff6f5c] active:bg-[#f2503b]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] gap-1.5",
  md: "h-11 px-5 text-[15px] gap-2",
  lg: "h-13 px-6 text-[16px] gap-2",
};

/** Shared button look, so `<Link>` can wear it without a Slot dependency. */
export function buttonStyles(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center rounded-[10px] font-bold whitespace-nowrap",
    "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45",
    SIZES[size],
    VARIANTS[variant],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonStyles(variant, size, className)} {...props} />
  );
}
