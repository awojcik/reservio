import { describe, expect, it } from "vitest";

import { toSearchParams } from "@/lib/api";
import {
  BEACH_RADIUS,
  EMPTY_QUERY,
  buildSearchParams,
  hasSearchCriteria,
  parseSearchQuery,
} from "@/lib/search";
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
    const params = toSearchParams(
      query({ destination: "Gdańsk", checkIn: "2026-09-12", checkOut: "2026-09-16" }),
    );

    expect(params).toMatchObject({
      destination: "Gdańsk",
      checkIn: "2026-09-12",
      checkOut: "2026-09-16",
      adults: 2,
      children: 0,
      sort: "RECOMMENDED",
    });
  });

  /**
   * A first-time visitor has chosen nothing. Sending a demo destination and a
   * demo week would answer a question nobody asked (§4).
   */
  it("sends no destination and no dates for a blank search", () => {
    const params = toSearchParams(query());

    expect(params.destination).toBeFalsy();
    expect(params.checkIn).toBeFalsy();
    expect(params.checkOut).toBeFalsy();
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
    expect(restored.checkIn).toBe("");
  });

  /** No parameters means no search — not a search for somewhere in particular. */
  it("parses an empty URL to a blank query", () => {
    expect(parseSearchQuery(new URLSearchParams(""))).toEqual(EMPTY_QUERY);
  });

  /**
   * A stay is both dates or neither. One alone cannot price anything, and
   * would reach `parseISO` in the calendar as an Invalid Date (§4).
   */
  it("ignores half a stay", () => {
    const onlyIn = parseSearchQuery(new URLSearchParams("checkIn=2026-09-12"));
    expect(onlyIn.checkIn).toBe("");
    expect(onlyIn.checkOut).toBe("");

    const onlyOut = parseSearchQuery(new URLSearchParams("checkOut=2026-09-16"));
    expect(onlyOut.checkOut).toBe("");
  });

  it("ignores a stay that is malformed or backwards", () => {
    expect(
      parseSearchQuery(new URLSearchParams("checkIn=wczoraj&checkOut=jutro")).checkIn,
    ).toBe("");

    // Check-out before check-in is not a stay.
    expect(
      parseSearchQuery(new URLSearchParams("checkIn=2026-09-16&checkOut=2026-09-12"))
        .checkIn,
    ).toBe("");
  });

  it("keeps a blank query out of the URL entirely", () => {
    expect(buildSearchParams(EMPTY_QUERY).toString()).toBe("");
  });

  it("knows when a query is worth remembering", () => {
    expect(hasSearchCriteria(EMPTY_QUERY)).toBe(false);
    expect(hasSearchCriteria(query({ destination: "Sopot" }))).toBe(true);
    expect(
      hasSearchCriteria(query({ checkIn: "2026-09-12", checkOut: "2026-09-16" })),
    ).toBe(true);
    // Filters alone are not a search: there is nothing to search through yet.
    expect(hasSearchCriteria(query({ pool: true }))).toBe(false);
  });
});
