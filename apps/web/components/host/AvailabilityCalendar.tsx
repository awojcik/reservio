"use client";

import { ChevronLeft, ChevronRight, Lock, Rss } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, type HostCalendarBlock } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import {
  buildMonthGrid,
  isDrawing,
  isWithinSelection,
  monthLabel,
  nextSelection,
  resolveSelection,
  shiftMonth,
  startOfMonth,
  toISODate,
  type Selection,
} from "@/lib/calendar";
import { cn } from "@/lib/cn";

const WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "so", "nd"];

/**
 * Month view with a two-click range selection. Deliberately not a calendar
 * clone: a Host needs to see what is taken, block a stretch of dates and free
 * one back up, and nothing more (milestone 03 §17).
 */
export function AvailabilityCalendar({ propertyId }: { propertyId: string }) {
  const { showToast } = useToast();
  const today = toISODate(new Date());

  const [month, setMonth] = useState(() => startOfMonth(today));
  const [blocks, setBlocks] = useState<HostCalendarBlock[]>([]);
  const [picking, setPicking] = useState<Selection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  // Three months of context, so a block spilling over a month edge is still
  // visible after navigating.
  const window = useMemo(
    () => ({ from: shiftMonth(month, -1), to: shiftMonth(month, 2) }),
    [month],
  );

  /** Refresh triggered by a Host action; safe to touch state synchronously. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const calendar = await apiClient.getHostCalendar(propertyId, window);
      setBlocks(calendar.blocks);
    } catch {
      showToast("Nie udało się wczytać kalendarza.");
    } finally {
      setLoading(false);
    }
  }, [propertyId, window, showToast]);

  // Every state update lands after the await, never synchronously inside the
  // effect, and a month change mid-flight discards the stale response.
  useEffect(() => {
    let cancelled = false;

    apiClient
      .getHostCalendar(propertyId, window)
      .then((calendar) => {
        if (cancelled) return;
        setBlocks(calendar.blocks);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        showToast("Nie udało się wczytać kalendarza.");
      });

    return () => {
      cancelled = true;
    };
  }, [propertyId, window, showToast]);

  const selection = useMemo(() => resolveSelection(picking, hovered), [picking, hovered]);

  const grid = useMemo(() => buildMonthGrid(month, blocks, today), [month, blocks, today]);

  /** True when every selected day is a manual block — the only unblockable case. */
  const selectionIsManual = useMemo(() => {
    if (!selection) return false;
    return grid
      .filter((day) => isWithinSelection(day.date, selection))
      .every((day) => day.block?.sourceType === "HOST_BLOCK");
  }, [grid, selection]);

  const selectionHasExternal = useMemo(() => {
    if (!selection) return false;
    return grid
      .filter((day) => isWithinSelection(day.date, selection))
      .some((day) => day.block?.sourceType === "EXTERNAL_CALENDAR");
  }, [grid, selection]);

  function pick(date: string) {
    setPicking((current) => {
      const next = nextSelection(current, date);
      // Once committed the range must stop tracking the cursor.
      setHovered(next.focus === null ? date : null);
      return next;
    });
  }

  function clearSelection() {
    setPicking(null);
    setHovered(null);
  }

  async function run(action: "block" | "unblock") {
    if (!selection) return;
    setPending(true);
    try {
      if (action === "block") {
        await apiClient.blockDates(propertyId, selection);
        showToast("Termin zablokowany.");
      } else {
        await apiClient.unblockDates(propertyId, selection);
        showToast("Termin zwolniony.");
      }
      clearSelection();
      await reload();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status === 400
          ? "Sprawdź zakres dat."
          : "Operacja się nie powiodła.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[18px] font-bold tracking-tight capitalize">{monthLabel(month)}</h3>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Poprzedni miesiąc"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft size={17} strokeWidth={2.4} />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMonth(startOfMonth(today))}>
            Dziś
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Następny miesiąc"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight size={17} strokeWidth={2.4} />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-1 text-[12px] font-bold text-muted">
            {day}
          </div>
        ))}

        {grid.map((day) => {
          const selected = isWithinSelection(day.date, selection);
          const external = day.block?.sourceType === "EXTERNAL_CALENDAR";
          const manual = day.block?.sourceType === "HOST_BLOCK";

          return (
            <button
              key={day.date}
              type="button"
              disabled={loading}
              onClick={() => pick(day.date)}
              onMouseEnter={() => isDrawing(picking) && setHovered(day.date)}
              title={day.block ? `${day.block.sourceLabel}${day.block.calendarName ? ` — ${day.block.calendarName}` : ""}` : undefined}
              className={cn(
                "relative flex h-11 items-center justify-center rounded-[8px] text-[14px] font-semibold transition-colors",
                day.inMonth ? "text-ink" : "text-muted/40",
                selected && "ring-2 ring-brand ring-offset-1",
                manual && "bg-brand/12",
                external && "bg-accent/15",
                !day.block && "hover:bg-ink/6",
                day.isToday && "font-extrabold underline underline-offset-4",
              )}
            >
              {Number(day.date.slice(8, 10))}
              {day.block ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 flex items-center justify-center"
                >
                  {external ? (
                    <Rss size={9} strokeWidth={3} className="text-accent-edge" />
                  ) : (
                    <Lock size={9} strokeWidth={3} className="text-brand" />
                  )}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[12px] font-semibold text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-brand/12" />
          <Lock size={11} strokeWidth={3} className="text-brand" />
          Blokada ręczna
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-accent/15" />
          <Rss size={11} strokeWidth={3} className="text-accent-edge" />
          Kalendarz zewnętrzny
        </span>
      </div>

      {selection ? (
        <div className="mt-4 rounded-[10px] border border-line bg-background px-4 py-3">
          <p className="text-[14px] font-bold">
            {selection.startDate} — {selection.endDate}
            <span className="ml-1 font-medium text-muted">(wyjazd w dniu końcowym)</span>
          </p>
          {isDrawing(picking) ? (
            <p className="mt-0.5 text-[13px] text-muted">
              Kliknij ostatni dzień, żeby zatwierdzić zakres.
            </p>
          ) : null}

          {selectionHasExternal ? (
            <p className="mt-1 text-[13px] text-muted">
              W zaznaczeniu są terminy z kalendarza zewnętrznego — tych nie można zwolnić
              ręcznie. Znikną po zmianie w źródłowym kalendarzu.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="accent" disabled={pending} onClick={() => run("block")}>
              {pending ? "Chwileczkę…" : "Zablokuj"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !selectionIsManual}
              onClick={() => run("unblock")}
            >
              Zwolnij
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
            >
              Anuluj
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted">
          Kliknij pierwszy, a potem ostatni dzień zakresu.
        </p>
      )}
    </div>
  );
}
