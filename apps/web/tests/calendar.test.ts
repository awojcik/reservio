import type { HostAllCalendarEvent } from "@rezervio/api-client";
import { describe, expect, it } from "vitest";

import {
  addDays,
  blockFor,
  daysBetween,
  endOfMonth,
  eventFor,
  buildMonthGrid,
  isDrawing,
  monthLabel,
  nextSelection,
  resolveSelection,
  selectionRange,
  shiftMonth,
  startOfMonth,
} from "../lib/calendar";
import type { HostCalendarBlock } from "@rezervio/api-client";

const block = (startDate: string, endDate: string): HostCalendarBlock => ({
  id: "b1",
  startDate,
  endDate,
  sourceType: "HOST_BLOCK",
  sourceLabel: "Ręczna blokada",
  calendarName: null,
  note: null,
});

describe("calendar grid", () => {
  it("starts the week on Monday and pads both ends", () => {
    // 1 September 2026 is a Tuesday, so one day of August leads the grid.
    const grid = buildMonthGrid("2026-09-01", [], "2026-09-15");

    expect(grid[0].date).toBe("2026-08-31");
    expect(grid[0].inMonth).toBe(false);
    expect(grid.length % 7).toBe(0);
    expect(grid.filter((day) => day.inMonth)).toHaveLength(30);
  });

  it("marks today", () => {
    const grid = buildMonthGrid("2026-09-01", [], "2026-09-15");
    expect(grid.filter((day) => day.isToday).map((day) => day.date)).toEqual(["2026-09-15"]);
  });

  it("treats the block end as exclusive", () => {
    const blocks = [block("2026-09-12", "2026-09-16")];

    expect(blockFor("2026-09-12", blocks)).not.toBeNull();
    expect(blockFor("2026-09-15", blocks)).not.toBeNull();
    // The 16th is free — the guest checking in that day is not affected.
    expect(blockFor("2026-09-16", blocks)).toBeNull();
  });
});

describe("selection", () => {
  it("covers both clicked days", () => {
    expect(selectionRange("2026-09-12", "2026-09-15")).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-16",
    });
  });

  it("works when clicked backwards", () => {
    expect(selectionRange("2026-09-15", "2026-09-12")).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-16",
    });
  });

  it("covers a single day", () => {
    expect(selectionRange("2026-09-12", "2026-09-12")).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-13",
    });
  });
});

/**
 * The two-click state machine. The first version tracked only a hover value,
 * so after the second click the range kept following the cursor and could
 * never be finished — these cover exactly that.
 */
describe("two-click range picking", () => {
  it("starts a range on the first click", () => {
    const picking = nextSelection(null, "2026-09-12");

    expect(picking).toEqual({ anchor: "2026-09-12", focus: null });
    expect(isDrawing(picking)).toBe(true);
  });

  it("previews with the cursor while drawing", () => {
    const picking = nextSelection(null, "2026-09-12");

    expect(resolveSelection(picking, "2026-09-15")).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-16",
    });
  });

  it("commits on the second click and stops drawing", () => {
    const started = nextSelection(null, "2026-09-12");
    const committed = nextSelection(started, "2026-09-15");

    expect(committed).toEqual({ anchor: "2026-09-12", focus: "2026-09-15" });
    expect(isDrawing(committed)).toBe(false);
  });

  it("ignores later hover once committed", () => {
    const committed = nextSelection(nextSelection(null, "2026-09-12"), "2026-09-15");

    // This is the regression: moving the mouse must not move the range.
    expect(resolveSelection(committed, "2026-09-28")).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-16",
    });
  });

  it("starts over on the third click", () => {
    const committed = nextSelection(nextSelection(null, "2026-09-12"), "2026-09-15");
    const restarted = nextSelection(committed, "2026-09-20");

    expect(restarted).toEqual({ anchor: "2026-09-20", focus: null });
  });

  it("handles a range picked backwards", () => {
    const committed = nextSelection(nextSelection(null, "2026-09-15"), "2026-09-12");

    expect(resolveSelection(committed, null)).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-16",
    });
  });

  it("selects a single day when both clicks land on it", () => {
    const committed = nextSelection(nextSelection(null, "2026-09-12"), "2026-09-12");

    expect(resolveSelection(committed, null)).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-13",
    });
  });

  it("resolves to nothing when no range is being picked", () => {
    expect(resolveSelection(null, "2026-09-12")).toBeNull();
  });
});

describe("month helpers", () => {
  it("moves across a year boundary", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("normalises to the first of the month", () => {
    expect(startOfMonth("2026-09-23")).toBe("2026-09-01");
  });

  it("labels the month in Polish", () => {
    expect(monthLabel("2026-09-01")).toContain("wrzesień");
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});

describe("unified calendar helpers", () => {
  const events: HostAllCalendarEvent[] = [
    {
      id: "1",
      type: "BOOKING",
      startDate: "2026-09-10",
      endDate: "2026-09-14",
      label: "Rezerwacja",
      sourceLabel: null,
      bookingReference: "RZV-1",
      guestName: "Jan Kowalski",
      expiresAt: null,
    },
    {
      id: "2",
      type: "HOST_BLOCK",
      startDate: "2026-09-20",
      endDate: "2026-09-22",
      label: "Ręczna blokada",
      sourceLabel: null,
      bookingReference: null,
      guestName: null,
      expiresAt: null,
    },
  ];

  it("lists every day of a half-open range", () => {
    expect(daysBetween("2026-09-01", "2026-09-04")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(daysBetween("2026-09-01", "2026-09-01")).toEqual([]);
  });

  it("spans a whole month", () => {
    expect(daysBetween("2026-09-01", endOfMonth("2026-09-01"))).toHaveLength(30);
    expect(endOfMonth("2026-09-14")).toBe("2026-10-01");
  });

  it("finds the event covering a day, end date exclusive", () => {
    expect(eventFor("2026-09-10", events)?.id).toBe("1");
    expect(eventFor("2026-09-13", events)?.id).toBe("1");
    // Check-out day is free again.
    expect(eventFor("2026-09-14", events)).toBeNull();
    expect(eventFor("2026-09-21", events)?.type).toBe("HOST_BLOCK");
  });
});
