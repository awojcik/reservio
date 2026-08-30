import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { calculatePriceQuote, countNights } from "../src/domain/pricing";

const balticLoft = {
  baseDailyRateAmountMinor: 45_000,
  cleaningFeeAmountMinor: 12_000,
  marketDailyRateAmountMinor: 49_500,
  currency: "PLN",
};

describe("calculatePriceQuote", () => {
  it("prices a four-night stay with the cleaning fee on top", () => {
    const quote = calculatePriceQuote(balticLoft, "2026-09-12", "2026-09-16");

    expect(quote.nights).toBe(4);
    expect(quote.accommodationAmountMinor).toBe(180_000);
    expect(quote.cleaningFeeAmountMinor).toBe(12_000);
    expect(quote.totalAmountMinor).toBe(192_000);
    expect(quote.currency).toBe("PLN");
  });

  it("derives the saving from MarketPrice over the same stay", () => {
    const quote = calculatePriceQuote(balticLoft, "2026-09-12", "2026-09-16");

    expect(quote.marketAmountMinor).toBe(210_000);
    expect(quote.savingAmountMinor).toBe(18_000);
  });

  it("reports no saving when there is no MarketPrice", () => {
    const quote = calculatePriceQuote(
      { ...balticLoft, marketDailyRateAmountMinor: null },
      "2026-09-12",
      "2026-09-16",
    );

    expect(quote.marketAmountMinor).toBeNull();
    expect(quote.savingAmountMinor).toBeNull();
  });

  it("never reports a negative saving", () => {
    const quote = calculatePriceQuote(
      { ...balticLoft, marketDailyRateAmountMinor: 30_000 },
      "2026-09-12",
      "2026-09-16",
    );

    expect(quote.savingAmountMinor).toBe(0);
  });

  it("rejects a range that does not contain a night", () => {
    expect(() => calculatePriceQuote(balticLoft, "2026-09-16", "2026-09-12")).toThrow(
      BadRequestException,
    );
    expect(() => calculatePriceQuote(balticLoft, "2026-09-12", "2026-09-12")).toThrow(
      BadRequestException,
    );
  });

  it("rejects dates that are not calendar dates", () => {
    expect(() => countNights("2026-09-12T00:00:00Z", "2026-09-16")).toThrow(
      BadRequestException,
    );
    expect(() => countNights("12.09.2026", "16.09.2026")).toThrow(BadRequestException);
  });

  it("counts nights across a month boundary", () => {
    expect(countNights("2026-08-30", "2026-09-02")).toBe(3);
  });
});
