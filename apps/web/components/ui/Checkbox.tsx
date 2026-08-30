"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function Checkbox({ label, checked, onChange, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-semibold select-none",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand",
          checked ? "border-brand bg-brand text-surface" : "border-line bg-surface",
        )}
      >
        {checked ? <Check size={14} strokeWidth={3} /> : null}
      </span>
      {label}
    </label>
  );
}
