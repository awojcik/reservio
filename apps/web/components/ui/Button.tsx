import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "outline" | "ghost" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-surface border border-brand hover:bg-brand-hover hover:border-brand-hover active:bg-brand-active",
  outline:
    "bg-transparent text-brand border border-brand hover:bg-brand/6 active:bg-brand/12",
  ghost:
    "bg-transparent text-ink border border-transparent hover:bg-ink/6 active:bg-ink/12",
  // Coral never carries white text — always ink, per the brand rules.
  accent:
    "bg-accent text-ink border border-accent-edge hover:bg-accent-hover active:bg-accent-edge",
};

/**
 * Same two variants, re-grounded for deep pine surfaces. A className override
 * would lose to the light variant depending on stylesheet order, so the tone
 * is chosen here rather than patched at the call site.
 */
const DARK_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-surface text-brand border border-surface hover:bg-background",
  outline:
    "bg-transparent text-surface border border-surface/45 hover:border-surface hover:bg-surface/10 active:bg-surface/15",
  ghost:
    "bg-transparent text-surface border border-transparent hover:bg-surface/10 active:bg-surface/15",
  accent:
    "bg-accent text-ink border border-accent-edge hover:bg-accent-hover active:bg-accent-edge",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] gap-1.5",
  md: "h-11 px-5 text-[15px] gap-2",
  lg: "h-13 px-6 text-[16px] gap-2",
};

export type ButtonTone = "light" | "dark";

/** Shared button look, so `<Link>` can wear it without a Slot dependency. */
export function buttonStyles(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
  tone: ButtonTone = "light",
): string {
  return cn(
    "inline-flex items-center justify-center rounded-[10px] font-bold whitespace-nowrap",
    "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45",
    SIZES[size],
    tone === "dark" ? DARK_VARIANTS[variant] : VARIANTS[variant],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Set on deep pine surfaces so the button re-grounds itself. */
  tone?: ButtonTone;
};

export function Button({
  variant = "primary",
  size = "md",
  tone = "light",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles(variant, size, className, tone)}
      {...props}
    />
  );
}
