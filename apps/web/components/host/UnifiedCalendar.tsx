"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Rows3 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, type HostAllCalendarProperty } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import {
  addDays,
  daysBetween,
  endOfMonth,
  eventFor,
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
import { formatLongDateRange } from "@/lib/format";

/**
 * One occupancy grid for every Property: rows are Properties, columns are the
 * days of the month (milestone 07 §14). It reads the `/host/calendar`
 * projection and writes through the existing Availability endpoints — no
 * second overlap or split rule lives here (§17).
 */
type Mode = "grid" | "list";

const EVENT_STYLES: Record<string, string> = {
  BOOKING: "bg-success/25 text-ink",
  BOOKING_HOLD: "bg-accent/25 text-ink",
  HOST_BLOCK: "bg-brand/20 text-ink",
  EXTERNAL_CALENDAR: "bg-ink/12 text-ink",
  MAINTENANCE: "bg-ink/12 text-ink",
};

/** A letter as well as a colour, so the grid is readable without colour (§15). */
const EVENT_MARKS: Record<string, string> = {
  BOOKING: "R",
  BOOKING_HOLD: "T",
  HOST_BLOCK: "B",
  EXTERNAL_CALENDAR: "Z",
  MAINTENANCE: "S",
};

const LEGEND = [
  { type: "BOOKING", label: "Rezerwacja" },
  { type: "BOOKING_HOLD", label: "Tymczasowo zablokowane" },
  { type: "HOST_BLOCK", label: "Ręczna blokada" },
  { type: "EXTERNAL_CALENDAR", label: "Kalendarz zewnętrzny" },
];

export function UnifiedCalendar() {
  const { showToast } = useToast();
  const today = toISODate(new Date());

  const [month, setMonth] = useState(() => startOfMonth(today));
  const [mode, setMode] = useState<Mode>("grid");
  const [propertyId, setPropertyId] = useState("");
  const [properties, setProperties] = useState<HostAllCalendarProperty[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [picking, setPicking] = useState<Selection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const range = useMemo(() => ({ from: month, to: endOfMonth(month) }), [month]);
  const days = useMemo(() => daysBetween(range.from, range.to), [range]);

  const query = useMemo(
    () => (propertyId ? { ...range, propertyId } : range),
    [range, propertyId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const calendar = await apiClient.getHostAllCalendar(query);
      setProperties(calendar.properties);
      setFailed(false);
    } catch {
      setFailed(true);
      showToast("Nie udało się wczytać kalendarza.");
    } finally {
      setLoading(false);
    }
  }, [query, showToast]);

  // State is only touched after the await, and a filter change mid-flight
  // discards the stale response.
  useEffect(() => {
    let cancelled = false;

    apiClient
      .getHostAllCalendar(query)
      .then((calendar) => {
        if (cancelled) return;
        setProperties(calendar.properties);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const selection = useMemo(() => resolveSelection(picking, hovered), [picking, hovered]);
  const selected = properties.find((property) => property.id === target) ?? null;

  /** Only a stretch of purely manual blocks can be handed back to Availability. */
  const selectionIsManual = useMemo(() => {
    if (!selection || !selected) return false;
    return daysBetween(selection.startDate, selection.endDate).every(
      (date) => eventFor(date, selected.events)?.type === "HOST_BLOCK",
    );
  }, [selection, selected]);

  const selectionIsFree = useMemo(() => {
    if (!selection || !selected) return false;
    return daysBetween(selection.startDate, selection.endDate).every(
      (date) => eventFor(date, selected.events) === null,
    );
  }, [selection, selected]);

  function pick(property: string, date: string) {
    // Switching Property starts a new range: a block never spans two objects.
    if (property !== target) {
      setTarget(property);
      setPicking({ anchor: date, focus: null });
      setHovered(null);
      return;
    }

    setPicking((current) => {
      const next = nextSelection(current, date);
      setHovered(next.focus === null ? date : null);
      return next;
    });
  }

  function clearSelection() {
    setPicking(null);
    setHovered(null);
    setTarget(null);
  }

  async function run(action: "block" | "unblock") {
    if (!selection || !target) return;
    setPending(true);
    try {
      if (action === "block") {
        await apiClient.blockDates(target, selection);
        showToast("Termin zablokowany.");
      } else {
        await apiClient.unblockDates(target, selection);
        showToast("Termin zwolniony.");
      }
      clearSelection();
      await load();
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
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Poprzedni miesiąc"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft size={17} strokeWidth={2.4} />
          </Button>
          <h2 className="min-w-[9.5rem] text-center text-[18px] font-bold tracking-tight capitalize">
            {monthLabel(month)}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Następny miesiąc"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight size={17} strokeWidth={2.4} />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMonth(startOfMonth(today))}>
            Dziś
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="calendar-property">
            Obiekt
          </label>
          <select
            id="calendar-property"
            value={propertyId}
            onChange={(event) => {
              setPropertyId(event.target.value);
              clearSelection();
            }}
            className="h-9 rounded-[10px] border border-line bg-surface px-3 text-[14px] font-semibold"
          >
            <option value="">Wszystkie obiekty</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.title}
              </option>
            ))}
          </select>

          <div className="flex rounded-[10px] border border-line bg-surface p-0.5">
            <ModeButton
              active={mode === "grid"}
              onClick={() => setMode("grid")}
              label="Siatka"
              icon={<CalendarDays size={15} strokeWidth={2.4} />}
            />
            <ModeButton
              active={mode === "list"}
              onClick={() => setMode("list")}
              label="Lista"
              icon={<Rows3 size={15} strokeWidth={2.4} />}
            />
          </div>
        </div>
      </div>

      {failed ? (
        <div className="mt-6 rounded-[14px] border border-line bg-surface px-5 py-8 text-center">
          <p className="text-[15px] text-muted">Nie udało się wczytać kalendarza.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={load}>
            Spróbuj ponownie
          </Button>
        </div>
      ) : loading ? (
        <p className="mt-6 rounded-[14px] border border-line bg-surface px-5 py-10 text-center text-[15px] text-muted">
          Wczytuję kalendarz…
        </p>
      ) : properties.length === 0 ? (
        <p className="mt-6 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
          Nie masz obiektów do pokazania w kalendarzu.
        </p>
      ) : mode === "grid" ? (
        <OccupancyGrid
          properties={properties}
          days={days}
          today={today}
          target={target}
          selection={selection}
          drawing={isDrawing(picking)}
          onPick={pick}
          onHover={(date) => isDrawing(picking) && setHovered(date)}
        />
      ) : (
        <EventList properties={properties} />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] font-semibold text-muted">
        {LEGEND.map((entry) => (
          <span key={entry.type} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-[4px] text-[10px] font-extrabold",
                EVENT_STYLES[entry.type],
              )}
            >
              {EVENT_MARKS[entry.type]}
            </span>
            {entry.label}
          </span>
        ))}
      </div>

      {selection && selected ? (
        <div className="mt-4 rounded-[10px] border border-line bg-background px-4 py-3">
          <p className="text-[14px] font-bold">
            {selected.title}: {selection.startDate} — {selection.endDate}
            <span className="ml-1 font-medium text-muted">(wyjazd w dniu końcowym)</span>
          </p>
          {isDrawing(picking) ? (
            <p className="mt-0.5 text-[13px] text-muted">
              Kliknij ostatni dzień, żeby zatwierdzić zakres.
            </p>
          ) : null}
          {!selectionIsFree && !selectionIsManual ? (
            <p className="mt-1 text-[13px] text-muted">
              W zaznaczeniu są terminy, których nie zwolnisz ręcznie — rezerwacje i wpisy z
              kalendarzy zewnętrznych znikną same.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="accent"
              disabled={pending || isDrawing(picking)}
              onClick={() => run("block")}
            >
              {pending ? "Chwileczkę…" : "Zablokuj"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || isDrawing(picking) || !selectionIsManual}
              onClick={() => run("unblock")}
            >
              Zwolnij
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Anuluj
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted">
          Kliknij pierwszy, a potem ostatni dzień w wierszu obiektu, żeby zablokować albo
          zwolnić termin.
        </p>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
}: Readonly<{
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-bold transition-colors",
        active ? "bg-ink text-surface" : "text-muted hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Rows are Properties, columns are days. On a narrow screen the grid scrolls
 * horizontally with the Property names pinned, which beats squeezing a month
 * into 320 px (§29).
 */
function OccupancyGrid({
  properties,
  days,
  today,
  target,
  selection,
  drawing,
  onPick,
  onHover,
}: Readonly<{
  properties: HostAllCalendarProperty[];
  days: string[];
  today: string;
  target: string | null;
  selection: { startDate: string; endDate: string } | null;
  drawing: boolean;
  onPick: (propertyId: string, date: string) => void;
  onHover: (date: string) => void;
}>) {
  return (
    <div className="mt-5 overflow-x-auto rounded-[14px] border border-line bg-surface">
      <table className="w-full border-collapse text-center">
        <caption className="sr-only">
          Zajętość obiektów dzień po dniu. Kolumny to kolejne dni miesiąca.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[10rem] bg-surface px-3 py-2 text-left text-[12px] font-bold text-muted"
            >
              Obiekt
            </th>
            {days.map((date) => (
              <th
                key={date}
                scope="col"
                className={cn(
                  "min-w-[2rem] px-0 py-2 text-[11px] font-bold tabular-nums",
                  date === today ? "text-ink underline underline-offset-4" : "text-muted",
                )}
              >
                {Number(date.slice(8, 10))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {properties.map((property) => (
            <tr key={property.id} className="border-t border-line">
              <th
                scope="row"
                className="sticky left-0 z-10 max-w-[12rem] truncate bg-surface px-3 py-2 text-left text-[13px] font-bold"
              >
                {property.title}
              </th>
              {days.map((date) => {
                const event = eventFor(date, property.events);
                const inSelection =
                  target === property.id && isWithinSelection(date, selection);

                return (
                  <td key={date} className="p-0">
                    <button
                      type="button"
                      onClick={() => onPick(property.id, date)}
                      onMouseEnter={() => drawing && target === property.id && onHover(date)}
                      title={describeEvent(property.title, date, event)}
                      aria-label={describeEvent(property.title, date, event)}
                      className={cn(
                        "flex h-9 w-full items-center justify-center text-[11px] font-extrabold transition-colors",
                        event ? EVENT_STYLES[event.type] : "hover:bg-ink/6",
                        inSelection && "ring-2 ring-brand ring-inset",
                      )}
                    >
                      {event ? EVENT_MARKS[event.type] : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The mobile-friendly reading of the same projection. */
function EventList({ properties }: { properties: HostAllCalendarProperty[] }) {
  const empty = properties.every((property) => property.events.length === 0);

  if (empty) {
    return (
      <p className="mt-5 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
        W tym miesiącu nie ma żadnych zajętych terminów.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-6">
      {properties
        .filter((property) => property.events.length > 0)
        .map((property) => (
          <section key={property.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[16px] font-bold tracking-tight">{property.title}</h3>
              <Link
                href={`/host/properties/${property.id}/calendar`}
                className="text-[13px] font-bold underline underline-offset-4"
              >
                Kalendarz obiektu
              </Link>
            </div>

            <ul className="mt-2 space-y-2">
              {property.events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-extrabold",
                      EVENT_STYLES[event.type],
                    )}
                  >
                    {EVENT_MARKS[event.type]}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold">
                      {event.label}
                      {event.bookingReference ? (
                        <span className="ml-2 text-[12px] font-bold text-muted tabular-nums">
                          {event.bookingReference}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {/* Half-open: the last occupied night is the day before the end. */}
                      {formatLongDateRange(event.startDate, event.endDate)}
                      {event.guestName ? ` · ${event.guestName}` : ""}
                      {event.sourceLabel ? ` · ${event.sourceLabel}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function describeEvent(
  propertyTitle: string,
  date: string,
  event: { label: string; guestName: string | null } | null,
): string {
  const day = formatLongDateRange(date, addDays(date, 1));
  if (!event) return `${propertyTitle}, ${day}: wolne`;
  return `${propertyTitle}, ${day}: ${event.label}${
    event.guestName ? ` — ${event.guestName}` : ""
  }`;
}
