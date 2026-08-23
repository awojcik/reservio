"use client";

import { Users } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Stepper } from "@/components/ui/Stepper";
import { formatGuests } from "@/lib/format";

type GuestsPopoverProps = {
  adults: number;
  childrenCount: number;
  onChange: (guests: { adults: number; children: number }) => void;
};

export function GuestsPopover({
  adults,
  childrenCount,
  onChange,
}: GuestsPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-14 w-full items-center gap-2.5 px-4 text-left transition-colors hover:bg-ink/[0.03]"
        >
          <Users size={17} strokeWidth={2.2} className="shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
              Goście
            </span>
            <span className="block truncate text-[15px] font-bold">
              {formatGuests(adults, childrenCount)}
            </span>
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[300px]">
        <Stepper
          label="Dorośli"
          value={adults}
          min={1}
          max={16}
          onChange={(value) => onChange({ adults: value, children: childrenCount })}
        />
        <div className="my-1 border-t border-line" />
        <Stepper
          label="Dzieci"
          hint="do 12 lat"
          value={childrenCount}
          min={0}
          max={10}
          onChange={(value) => onChange({ adults, children: value })}
        />
      </PopoverContent>
    </Popover>
  );
}
