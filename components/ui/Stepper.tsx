"use client";

import { Minus, Plus } from "lucide-react";

type StepperProps = {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
};

export function Stepper({
  label,
  hint,
  value,
  min = 0,
  max = 16,
  onChange,
}: StepperProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-2">
      <div>
        <div className="text-[15px] font-bold">{label}</div>
        {hint ? <div className="text-[13px] text-muted">{hint}</div> : null}
      </div>

      <div className="flex items-center gap-1">
        <StepButton
          label={`Zmniejsz: ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus size={16} strokeWidth={2.5} />
        </StepButton>

        <output
          aria-live="polite"
          className="w-9 text-center text-[16px] font-bold tabular-nums"
        >
          {value}
        </output>

        <StepButton
          label={`Zwiększ: ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <Plus size={16} strokeWidth={2.5} />
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink"
    >
      {children}
    </button>
  );
}
