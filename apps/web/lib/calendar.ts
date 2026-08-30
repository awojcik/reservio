import type { HostCalendarBlock } from "@rezervio/api-client";

/**
 * Calendar-grid helpers. Dates are plain `YYYY-MM-DD` strings throughout, the
 * same half-open convention the API uses — no Date objects in state, so there
 * is no timezone to shift a day.
 */
export type Day = {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  /** The block covering this day, if any. */
  block: HostCalendarBlock | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function shiftMonth(monthStart: string, delta: number): string {
  const [year, month] = monthStart.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return shifted.toISOString().slice(0, 10);
}

export function monthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthStart}T00:00:00Z`));
}

/**
 * A Monday-first grid covering the whole month plus the days needed to fill
 * the first and last weeks.
 */
export function buildMonthGrid(
  monthStart: string,
  blocks: HostCalendarBlock[],
  today: string,
): Day[] {
  const first = new Date(`${monthStart}T00:00:00Z`);
  const weekday = (first.getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(monthStart, -weekday);

  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const cellCount = Math.ceil((weekday + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = addDays(gridStart, index);
    return {
      date,
      inMonth: date.slice(0, 7) === monthStart.slice(0, 7),
      isToday: date === today,
      block: blockFor(date, blocks),
    };
  });
}

/** endDate is exclusive, so the last blocked night is the day before it. */
export function blockFor(date: string, blocks: HostCalendarBlock[]): HostCalendarBlock | null {
  return blocks.find((block) => block.startDate <= date && date < block.endDate) ?? null;
}

/**
 * Two-click range picking.
 *
 * `focus === null` means the range is still being drawn and follows the
 * cursor; once the second day is clicked the range is committed and stops
 * moving. Without that distinction hover would keep rewriting the end date
 * after the second click, and the selection could never be finished.
 */
export type Selection = { anchor: string; focus: string | null };

export function nextSelection(current: Selection | null, date: string): Selection {
  // Nothing started yet, or the previous range is already complete — either
  // way this click begins a new one.
  if (!current || current.focus !== null) return { anchor: date, focus: null };
  return { anchor: current.anchor, focus: date };
}

/** The range to render: committed if there is one, otherwise the hover preview. */
export function resolveSelection(
  selection: Selection | null,
  hovered: string | null,
): { startDate: string; endDate: string } | null {
  if (!selection) return null;
  return selectionRange(selection.anchor, selection.focus ?? hovered ?? selection.anchor);
}

/** True while the range is still following the cursor. */
export function isDrawing(selection: Selection | null): boolean {
  return selection !== null && selection.focus === null;
}

/** Normalises a two-click selection into a half-open range covering both days. */
export function selectionRange(
  anchor: string,
  target: string,
): { startDate: string; endDate: string } {
  const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
  // Both clicked days are meant to be blocked, so the exclusive end is the day
  // after the later one.
  return { startDate: from, endDate: addDays(to, 1) };
}

export function isWithinSelection(
  date: string,
  selection: { startDate: string; endDate: string } | null,
): boolean {
  if (!selection) return false;
  return selection.startDate <= date && date < selection.endDate;
}
