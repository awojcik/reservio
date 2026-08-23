import { describe, expect, it } from "vitest";

import { calculateTotalPrice } from "@/lib/pricing";
import type { Property } from "@/lib/types";

const base: Property = {
  id: "test",
  slug: "test",
  title: "Test",
  city: "Gdańsk",
  district: "Brzeźno",
  latitude: 54.4,
  longitude: 18.61,
  images: [],
  rating: 9,
  reviewCount: 10,
  bedrooms: 2,
  beds: 3,
  bathrooms: 1,
  maxGuests: 4,
  amenities: [],
  pricePerNight: 450,
  cleaningFee: 120,
  marketPrice: 500,
  propertyType: "apartment",
  description: "",
};

describe("calculateTotalPrice", () => {
  it("multiplies the nightly rate by the number of nights and adds cleaning", () => {
    const price = calculateTotalPrice(base, "2026-09-12", "2026-09-16");

    expect(price.nights).toBe(4);
    expect(price.accommodationPrice).toBe(1800);
    expect(price.cleaningFee).toBe(120);
    expect(price.totalPrice).toBe(1920);
  });

  it("derives the saving from the market rate over the same stay", () => {
    const price = calculateTotalPrice(base, "2026-09-12", "2026-09-16");

    expect(price.marketTotalPrice).toBe(2120);
    expect(price.saving).toBe(200);
  });

  it("never reports a negative saving", () => {
    const overpriced = { ...base, marketPrice: 300 };
    const price = calculateTotalPrice(overpriced, "2026-09-12", "2026-09-16");

    expect(price.saving).toBe(0);
  });

  it("falls back to a single night for an empty or reversed range", () => {
    expect(calculateTotalPrice(base, "2026-09-12", "2026-09-12").nights).toBe(1);
    expect(calculateTotalPrice(base, "2026-09-16", "2026-09-12").nights).toBe(1);
  });

  it("accepts Date objects as well as ISO strings", () => {
    const fromDates = calculateTotalPrice(
      base,
      new Date(2026, 8, 12),
      new Date(2026, 8, 16),
    );

    expect(fromDates.totalPrice).toBe(1920);
  });
});
