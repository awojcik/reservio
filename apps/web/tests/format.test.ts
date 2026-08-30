import { describe, expect, it } from "vitest";

import {
  formatBeachDistance,
  formatDestinationPhrase,
  formatGuests,
  formatNights,
  formatAmountMinor,
  formatResultCount,
} from "@/lib/format";

const NBSP = "\u00A0";

describe("formatAmountMinor", () => {
  it("renders minor units as złoty, grouping even four-digit amounts", () => {
    expect(formatAmountMinor(192_000)).toBe(`1${NBSP}920${NBSP}zł`);
    expect(formatAmountMinor(1_204_000)).toBe(`12${NBSP}040${NBSP}zł`);
    expect(formatAmountMinor(48_000)).toBe(`480${NBSP}zł`);
  });

  it("rounds to whole złoty", () => {
    expect(formatAmountMinor(191_960)).toBe(`1${NBSP}920${NBSP}zł`);
  });
});

describe("Polish plurals", () => {
  it("declines nights", () => {
    expect(formatNights(1)).toBe("1 noc");
    expect(formatNights(4)).toBe("4 noce");
    expect(formatNights(5)).toBe("5 nocy");
    expect(formatNights(22)).toBe("22 noce");
  });

  it("declines the result count", () => {
    expect(formatResultCount(1)).toBe("1 miejsce");
    expect(formatResultCount(3)).toBe("3 miejsca");
    expect(formatResultCount(12)).toBe("12 miejsc");
  });

  it("hides children when there are none", () => {
    expect(formatGuests(2, 0)).toBe("2 dorosłych");
    expect(formatGuests(1, 2)).toBe("1 dorosły, 2 dzieci");
  });
});

describe("misc formatting", () => {
  it("switches to kilometres past 1000 m", () => {
    expect(formatBeachDistance(280)).toBe("280 m do plaży");
    expect(formatBeachDistance(2600)).toBe("2,6 km do plaży");
  });

  it("uses the locative for known destinations and quotes the rest", () => {
    expect(formatDestinationPhrase("Gdansk")).toBe("w Gdańsku");
    expect(formatDestinationPhrase("Gdańsk")).toBe("w Gdańsku");
    expect(formatDestinationPhrase("Wrzeszcz")).toBe("we Wrzeszczu");
    expect(formatDestinationPhrase("Ustka")).toBe("dla „Ustka”");
    expect(formatDestinationPhrase("  ")).toBe("");
  });
});
