import { describe, expect, it } from "vitest";

import { toSearchParams } from "@/lib/api";
import { BEACH_RADIUS, EMPTY_QUERY, buildSearchParams, parseSearchQuery } from "@/lib/search";
import type { SearchQuery } from "@/lib/types";

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  ...EMPTY_QUERY,
  ...overrides,
});

/**
 * The web app no longer filters anything itself — its remaining responsibility
 * is turning URL state into a correct API request. That translation is what
 * these tests protect.
 */
describe("toSearchParams", () => {
  it("passes the stay and guests through unchanged", () => {
    const params = toSearchParams(query());

    expect(params).toMatchObject({
      destination: "Gdańsk",
      checkIn: "2026-09-12",
      checkOut: "2026-09-16",
      adults: 2,
      children: 2,
      sort: "RECOMMENDED",
    });
  });

  it("converts the price cap from złoty to minor units", () => {
    expect(toSearchParams(query({ maxPrice: 2500 })).maxPrice).toBe(250_000);
  });

  it("maps sort options onto domain values", () => {
    expect(toSearchParams(query({ sort: "price-asc" })).sort).toBe("LOWEST_PRICE");
    expect(toSearchParams(query({ sort: "best-value" })).sort).toBe("BEST_VALUE");
    expect(toSearchParams(query({ sort: "beach-asc" })).sort).toBe("CLOSEST_TO_BEACH");
  });

  it("maps property types onto domain values", () => {
    expect(toSearchParams(query({ propertyTypes: ["villa", "house"] })).propertyType).toEqual(
      ["VILLA", "HOUSE"],
    );
  });

  it("expresses the beach filter as a distance in meters", () => {
    expect(toSearchParams(query({ nearBeach: true })).maxBeachDistanceMeters).toBe(
      BEACH_RADIUS,
    );
    expect(toSearchParams(query()).maxBeachDistanceMeters).toBeUndefined();
  });

  it("sends amenity shortcuts alongside explicit codes", () => {
    const params = toSearchParams(query({ pool: true, parking: true, amenities: ["SAUNA"] }));

    expect(params.pool).toBe(true);
    expect(params.parking).toBe(true);
    expect(params.amenities).toEqual(["SAUNA"]);
  });

  it("forwards the map viewport as four bounds", () => {
    const params = toSearchParams(
      query({ bounds: { west: 18.55, south: 54.43, east: 18.6, north: 54.46 } }),
    );

    expect(params).toMatchObject({ north: 54.46, south: 54.43, east: 18.6, west: 18.55 });
  });

  it("omits filters that are not set", () => {
    const params = toSearchParams(query());

    expect(params.maxPrice).toBeUndefined();
    expect(params.propertyType).toBeUndefined();
    expect(params.amenities).toBeUndefined();
    expect(params.north).toBeUndefined();
  });
});

describe("URL state", () => {
  it("round-trips a query through search params", () => {
    const original = query({
      destination: "Sopot",
      adults: 3,
      children: 1,
      pool: true,
      maxPrice: 2500,
      minRating: 9,
      minBedrooms: 2,
      propertyTypes: ["villa"],
      amenities: ["SAUNA"],
      sort: "best-value",
    });

    expect(parseSearchQuery(buildSearchParams(original))).toEqual(original);
  });

  it("falls back to defaults for missing or invalid params", () => {
    const restored = parseSearchQuery(new URLSearchParams("sort=nonsense&adults=abc"));

    expect(restored.sort).toBe("recommended");
    expect(restored.adults).toBe(2);
    expect(restored.checkIn).toBe(EMPTY_QUERY.checkIn);
  });
});
