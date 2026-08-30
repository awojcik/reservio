import { describe, expect, it } from "vitest";

import {
  addDays,
  intersectRange,
  isAdjacent,
  isContiguous,
  mergeRanges,
  overlaps,
  subtractRange,
  assertValidRange,
} from "../src/domain/availability";

const r = (startDate: string, endDate: string) => ({ startDate, endDate });

/** Half-open `[start, end)` — the rule the whole milestone rests on (§6, §55). */
describe("range semantics", () => {
  it("overlaps when the ranges share a night", () => {
    expect(overlaps(r("2026-09-12", "2026-09-16"), r("2026-09-15", "2026-09-18"))).toBe(true);
  });

  it("does not overlap when one ends exactly where the other begins", () => {
    // A block ending on the 16th leaves the 16th free — the entire point of
    // exclusive end dates.
    expect(overlaps(r("2026-09-12", "2026-09-16"), r("2026-09-16", "2026-09-18"))).toBe(false);
  });

  it("overlaps itself", () => {
    expect(overlaps(r("2026-09-12", "2026-09-16"), r("2026-09-12", "2026-09-16"))).toBe(true);
  });

  it("treats touching ranges as adjacent but not overlapping", () => {
    const a = r("2026-09-10", "2026-09-12");
    const b = r("2026-09-12", "2026-09-15");

    expect(isAdjacent(a, b)).toBe(true);
    expect(overlaps(a, b)).toBe(false);
    expect(isContiguous(a, b)).toBe(true);
  });

  it("rejects an empty or inverted range", () => {
    expect(() => assertValidRange(r("2026-09-16", "2026-09-16"))).toThrow();
    expect(() => assertValidRange(r("2026-09-16", "2026-09-12"))).toThrow();
    expect(() => assertValidRange(r("16-09-2026", "2026-09-18"))).toThrow();
  });
});

describe("mergeRanges", () => {
  it("joins adjacent ranges", () => {
    expect(mergeRanges([r("2026-09-10", "2026-09-12"), r("2026-09-12", "2026-09-15")])).toEqual([
      r("2026-09-10", "2026-09-15"),
    ]);
  });

  it("joins overlapping ranges", () => {
    expect(mergeRanges([r("2026-09-10", "2026-09-14"), r("2026-09-12", "2026-09-15")])).toEqual([
      r("2026-09-10", "2026-09-15"),
    ]);
  });

  it("leaves a gap alone", () => {
    expect(mergeRanges([r("2026-09-10", "2026-09-12"), r("2026-09-13", "2026-09-15")])).toEqual([
      r("2026-09-10", "2026-09-12"),
      r("2026-09-13", "2026-09-15"),
    ]);
  });

  it("absorbs a fully contained range", () => {
    expect(mergeRanges([r("2026-09-10", "2026-09-20"), r("2026-09-12", "2026-09-15")])).toEqual([
      r("2026-09-10", "2026-09-20"),
    ]);
  });

  it("is order-independent", () => {
    const unsorted = [r("2026-09-13", "2026-09-15"), r("2026-09-10", "2026-09-13")];
    expect(mergeRanges(unsorted)).toEqual([r("2026-09-10", "2026-09-15")]);
  });
});

describe("subtractRange", () => {
  it("splits a range when the hole is in the middle", () => {
    expect(subtractRange(r("2026-09-12", "2026-09-16"), r("2026-09-13", "2026-09-14"))).toEqual([
      r("2026-09-12", "2026-09-13"),
      r("2026-09-14", "2026-09-16"),
    ]);
  });

  it("trims the left side", () => {
    expect(subtractRange(r("2026-09-12", "2026-09-16"), r("2026-09-10", "2026-09-14"))).toEqual([
      r("2026-09-14", "2026-09-16"),
    ]);
  });

  it("trims the right side", () => {
    expect(subtractRange(r("2026-09-12", "2026-09-16"), r("2026-09-14", "2026-09-20"))).toEqual([
      r("2026-09-12", "2026-09-14"),
    ]);
  });

  it("removes the range entirely when swallowed", () => {
    expect(subtractRange(r("2026-09-12", "2026-09-16"), r("2026-09-01", "2026-10-01"))).toEqual([]);
  });

  it("is a no-op for a touching hole", () => {
    expect(subtractRange(r("2026-09-12", "2026-09-16"), r("2026-09-16", "2026-09-18"))).toEqual([
      r("2026-09-12", "2026-09-16"),
    ]);
  });
});

describe("helpers", () => {
  it("intersects or reports no overlap", () => {
    expect(intersectRange(r("2026-09-10", "2026-09-20"), r("2026-09-15", "2026-09-25"))).toEqual(
      r("2026-09-15", "2026-09-20"),
    );
    expect(intersectRange(r("2026-09-10", "2026-09-12"), r("2026-09-12", "2026-09-14"))).toBeNull();
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-09-28", 5)).toBe("2026-10-03");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
