"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { pl } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { cn } from "@/lib/cn";
import { formatDateRange, formatNights } from "@/lib/format";
import { differenceInCalendarDays } from "date-fns";

const WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "so", "nd"];

type DatesPopoverProps = {
  checkIn: string;
  checkOut: string;
  onChange: (checkIn: string, checkOut: string) => void;
};

/**
 * Deliberately small: one month at a time, click start then end.
 * A full availability calendar belongs to the booking milestone.
 */
export function DatesPopover({
  checkIn,
  checkOut,
  onChange,
}: DatesPopoverProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(checkIn)));
  const [pendingStart, setPendingStart] = useState<Date | null>(null);

  const from = parseISO(checkIn);
  const to = parseISO(checkOut);
  const nights = Math.max(1, differenceInCalendarDays(to, from));

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  function selectDay(day: Date) {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }

    if (isBefore(day, pendingStart) || isSameDay(day, pendingStart)) {
      setPendingStart(day);
      return;
    }

    onChange(format(pendingStart, "yyyy-MM-dd"), format(day, "yyyy-MM-dd"));
    setPendingStart(null);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPendingStart(null);
        if (next) setMonth(startOfMonth(parseISO(checkIn)));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-14 w-full items-center gap-2.5 px-4 text-left transition-colors hover:bg-ink/[0.03]"
        >
          <CalendarDays size={17} strokeWidth={2.2} className="shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
              Termin
            </span>
            <span className="block truncate text-[15px] font-bold">
              {formatDateRange(checkIn, checkOut)}
            </span>
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[348px]">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Poprzedni miesiąc"
            onClick={() => setMonth(addMonths(month, -1))}
            className="flex size-11 items-center justify-center rounded-full border border-line transition-colors hover:border-brand hover:text-brand"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>

          <div aria-live="polite" className="text-[15px] font-bold">
            {format(month, "LLLL yyyy", { locale: pl })}
          </div>

          <button
            type="button"
            aria-label="Następny miesiąc"
            onClick={() => setMonth(addMonths(month, 1))}
            className="flex size-11 items-center justify-center rounded-full border border-line transition-colors hover:border-brand hover:text-brand"
          >
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((day) => (
            <div key={day} className="pb-1 text-[11px] font-bold text-muted uppercase">
              {day}
            </div>
          ))}

          {days.map((day) => {
            const outside = !isSameMonth(day, month);
            const isStart = pendingStart
              ? isSameDay(day, pendingStart)
              : isSameDay(day, from);
            const isEnd = !pendingStart && isSameDay(day, to);
            const inRange =
              !pendingStart &&
              isBefore(from, day) &&
              isBefore(day, to) &&
              !isStart &&
              !isEnd;
            const isPast = isBefore(day, startOfDay(new Date()));

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={isPast}
                onClick={() => selectDay(day)}
                aria-label={format(day, "d MMMM yyyy", { locale: pl })}
                aria-pressed={isStart || isEnd}
                className={cn(
                  "mx-auto flex size-11 items-center justify-center rounded-[9px] text-[14px] font-bold tabular-nums transition-colors",
                  outside && "text-muted/70",
                  isPast && "cursor-not-allowed text-muted/30 line-through",
                  !isPast && !isStart && !isEnd && "hover:bg-brand/8",
                  inRange && "bg-brand/10",
                  (isStart || isEnd) && "bg-brand text-surface",
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
          {pendingStart
            ? `Wybierz datę wyjazdu — przyjazd ${format(pendingStart, "d MMMM", { locale: pl })}`
            : `${formatNights(nights)} · kliknij, aby wybrać nowy termin`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
