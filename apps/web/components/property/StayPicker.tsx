"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import {
  canCheckIn,
  canCheckOut,
  nextStay,
  type UnavailableRange,
} from "@/lib/availability";
import { addDays, monthLabel, shiftMonth, startOfMonth } from "@/lib/calendar";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

const WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "so", "nd"];

type StayPickerProps = {
  checkIn: string;
  checkOut: string;
  onChange: (stay: { checkIn: string; checkOut: string }) => void;
  /** Taken dates from the public availability endpoint. */
  ranges: readonly UnavailableRange[];
  /** Today in the Property time zone — not in the visitor's. */
  today: string;
  /** Exclusive end of the window the calendar knows anything about. */
  horizon: string;
  /** The taken dates are still on their way. */
  loading?: boolean;
  /**
   * The taken dates could not be fetched. The calendar still opens: the
   * server re-checks the stay anyway, and a picker that refuses to work is
   * worse than one that occasionally offers a night somebody else just took.
   */
  unknownAvailability?: boolean;
  /** Opened programmatically by the CTA, which is the only affordance when no
   * dates are chosen yet. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Monday-first grid covering the whole month plus the surrounding part-weeks. */
function monthGrid(monthStart: string): string[] {
  const first = new Date(`${monthStart}T00:00:00Z`);
  const weekday = (first.getUTCDay() + 6) % 7;
  const gridStart = addDays(monthStart, -weekday);

  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const cells = Math.ceil((weekday + daysInMonth) / 7) * 7;

  return Array.from({ length: cells }, (_, index) => addDays(gridStart, index));
}

/**
 * The Guest's calendar on the Property page.
 *
 * Taken nights are unselectable, with the half-open rule visible in the
 * behaviour: the day a neighbouring stay checks out is a perfectly good day to
 * check in, and the day the next one begins is a perfectly good day to leave.
 *
 * It is not the source of truth and does not pretend to be — see
 * `lib/availability.ts`.
 */
export function StayPicker({
  checkIn,
  checkOut,
  onChange,
  ranges,
  today,
  horizon,
  loading = false,
  unknownAvailability = false,
  open,
  onOpenChange,
}: StayPickerProps) {
  const [month, setMonth] = useState(() => startOfMonth(checkIn || today));
  /** The anchor while a range is being drawn; empty once it is complete. */
  const [pending, setPending] = useState("");

  /*
   * Adjusted while rendering, not in an effect: the calendar has to be on the
   * right month in the first frame after it opens, and a half-drawn range must
   * not survive a close. Doing this after paint would show the wrong month
   * first and then jump (react.dev — "adjusting state when a prop changes").
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMonth(startOfMonth(checkIn || today));
    else setPending("");
  }

  const drawing = pending !== "";
  const anchor = drawing ? pending : checkIn;
  const previewOut = drawing ? "" : checkOut;

  function select(date: string) {
    const current = drawing ? { checkIn: pending, checkOut: "" } : { checkIn, checkOut };
    const next = nextStay(current, date, ranges, horizon);

    if (next.checkOut) {
      setPending("");
      onChange(next);
      onOpenChange(false);
      return;
    }

    setPending(next.checkIn);
  }

  const canGoBack = month > startOfMonth(today);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Wybierz daty pobytu"
          className="grid w-full grid-cols-2 divide-x divide-line rounded-[10px] border border-line bg-surface text-left transition-colors hover:border-ink/35"
        >
          <span className="flex min-w-0 items-center gap-2 px-3.5 py-2.5">
            <CalendarDays size={16} strokeWidth={2.2} className="shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
                Przyjazd
              </span>
              <span
                className={cn(
                  "block truncate text-[15px] font-bold",
                  !checkIn && "text-muted",
                )}
              >
                {checkIn ? formatDate(checkIn) : "wybierz"}
              </span>
            </span>
          </span>

          <span className="min-w-0 px-3.5 py-2.5">
            <span className="block text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
              Wyjazd
            </span>
            <span
              className={cn(
                "block truncate text-[15px] font-bold",
                !checkOut && "text-muted",
              )}
            >
              {checkOut ? formatDate(checkOut) : "wybierz"}
            </span>
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[340px]">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Poprzedni miesiąc"
            disabled={!canGoBack}
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex size-11 items-center justify-center rounded-full border border-line transition-colors hover:border-brand hover:text-brand disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>

          <div aria-live="polite" className="text-[15px] font-bold first-letter:uppercase">
            {monthLabel(month)}
          </div>

          <button
            type="button"
            aria-label="Następny miesiąc"
            disabled={shiftMonth(month, 1) >= horizon}
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex size-11 items-center justify-center rounded-full border border-line transition-colors hover:border-brand hover:text-brand disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink"
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

          {monthGrid(month).map((date) => {
            const outside = date.slice(0, 7) !== month.slice(0, 7);
            // While drawing, only days that can close this stay are offered.
            const selectable = drawing
              ? canCheckOut(date, pending, ranges, horizon)
              : canCheckIn(date, ranges, today) && date < horizon;

            const isStart = date === anchor;
            const isEnd = previewOut !== "" && date === previewOut;
            const inRange =
              previewOut !== "" && anchor !== "" && date > anchor && date < previewOut;

            return (
              <button
                key={date}
                type="button"
                disabled={!selectable}
                onClick={() => select(date)}
                aria-label={formatDate(date)}
                aria-pressed={isStart || isEnd}
                className={cn(
                  "mx-auto flex size-11 items-center justify-center rounded-[9px] text-[14px] font-bold tabular-nums transition-colors",
                  outside && "text-muted/70",
                  !selectable && "cursor-not-allowed text-muted/30 line-through",
                  selectable && !isStart && !isEnd && "hover:bg-brand/8",
                  inRange && "bg-brand/10",
                  (isStart || isEnd) && "bg-brand text-surface",
                )}
              >
                {date.slice(8)}
              </button>
            );
          })}
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
          {loading
            ? "Sprawdzamy zajęte terminy…"
            : unknownAvailability
              ? "Nie udało się pobrać zajętych terminów. Dostępność potwierdzimy po wybraniu dat."
              : drawing
                ? `Wybierz datę wyjazdu — przyjazd ${formatDate(pending)}`
                : checkIn && checkOut
                  ? "Kliknij, aby wybrać nowy termin"
                  : "Przekreślone dni są już zajęte"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
