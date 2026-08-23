import { describe, expect, it } from "vitest";

import { PROPERTIES } from "@/data/properties";
import {
  EMPTY_QUERY,
  buildSearchParams,
  countActiveFilters,
  filterProperties,
  parseSearchQuery,
  sortProperties,
} from "@/lib/search";
import type { SearchQuery } from "@/lib/types";

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  ...EMPTY_QUERY,
  ...overrides,
});

const ids = (results: { property: { id: string } }[]) =>
  results.map(({ property }) => property.id);

describe("filterProperties", () => {
  it("matches the destination on city, district and title, ignoring diacritics", () => {
    const withDiacritics = filterProperties(PROPERTIES, query({ destination: "Gdańsk" }));
    const without = filterProperties(PROPERTIES, query({ destination: "Gdansk" }));

    expect(ids(withDiacritics)).toEqual(ids(without));
    expect(withDiacritics.length).toBeGreaterThan(0);
    expect(
      withDiacritics.every(({ property }) => property.city === "Gdańsk"),
    ).toBe(true);
  });

  it("filters by district", () => {
    const results = filterProperties(PROPERTIES, query({ destination: "Brzeźno" }));

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ property }) => property.district === "Brzeźno")).toBe(true);
  });

  it("drops places that cannot host all guests", () => {
    const results = filterProperties(
      PROPERTIES,
      query({ destination: "", adults: 6, children: 2 }),
    );

    expect(results.every(({ property }) => property.maxGuests >= 8)).toBe(true);
  });

  it("applies amenity toggles", () => {
    const results = filterProperties(
      PROPERTIES,
      query({ destination: "", pool: true, parking: true }),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        ({ property }) =>
          property.amenities.includes("pool") && property.amenities.includes("parking"),
      ),
    ).toBe(true);
  });

  it("treats 'near the beach' as 500 m or less", () => {
    const results = filterProperties(PROPERTIES, query({ destination: "", nearBeach: true }));

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        ({ property }) =>
          property.distanceToBeach !== undefined && property.distanceToBeach <= 500,
      ),
    ).toBe(true);
  });

  it("caps results by the total price of the stay, not the nightly rate", () => {
    const maxPrice = 2000;
    const results = filterProperties(PROPERTIES, query({ destination: "", maxPrice }));

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ price }) => price.totalPrice <= maxPrice)).toBe(true);
  });

  it("keeps only properties inside the map viewport", () => {
    const results = filterProperties(
      PROPERTIES,
      query({
        destination: "",
        bounds: { west: 18.55, south: 54.43, east: 18.6, north: 54.46 },
      }),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ property }) => property.city === "Sopot")).toBe(true);
  });

  it("returns nothing when the filters contradict each other", () => {
    const results = filterProperties(
      PROPERTIES,
      query({ destination: "Gdańsk", propertyTypes: ["studio"], minBedrooms: 4 }),
    );

    expect(results).toHaveLength(0);
  });
});

describe("sortProperties", () => {
  const results = filterProperties(PROPERTIES, query({ destination: "" }));

  it("sorts by total price ascending", () => {
    const sorted = sortProperties(results, "price-asc");
    const prices = sorted.map(({ price }) => price.totalPrice);

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("sorts by rating descending", () => {
    const sorted = sortProperties(results, "rating-desc");

    expect(sorted[0].property.rating).toBe(
      Math.max(...results.map(({ property }) => property.rating)),
    );
  });

  it("puts places without a beach distance last", () => {
    const sorted = sortProperties(results, "beach-asc");
    const lastWithBeach = sorted.findIndex(
      ({ property }) => property.distanceToBeach === undefined,
    );

    expect(
      sorted
        .slice(lastWithBeach)
        .every(({ property }) => property.distanceToBeach === undefined),
    ).toBe(true);
  });

  it("sorts best value by the biggest saving", () => {
    const sorted = sortProperties(results, "best-value");

    expect(sorted[0].price.saving).toBe(
      Math.max(...results.map(({ price }) => price.saving)),
    );
  });

  it("does not mutate the input array", () => {
    const before = ids(results);
    sortProperties(results, "price-asc");

    expect(ids(results)).toEqual(before);
  });
});

describe("URL state", () => {
  it("round-trips a query through search params", () => {
    const original = query({
      destination: "Sopot",
      adults: 3,
      children: 1,
      pool: true,
      parking: true,
      maxPrice: 2500,
      minRating: 9,
      minBedrooms: 2,
      propertyTypes: ["villa", "house"],
      amenities: ["sauna"],
      sort: "best-value",
    });

    const restored = parseSearchQuery(buildSearchParams(original));

    expect(restored).toEqual(original);
  });

  it("omits defaults from the URL", () => {
    expect(buildSearchParams(query()).toString()).toBe("destination=Gda%C5%84sk");
  });

  it("falls back to defaults for missing or invalid params", () => {
    const restored = parseSearchQuery(new URLSearchParams("sort=nonsense&adults=abc"));

    expect(restored.sort).toBe("recommended");
    expect(restored.adults).toBe(2);
    expect(restored.checkIn).toBe(EMPTY_QUERY.checkIn);
  });

  it("counts only the filters that narrow the results", () => {
    expect(countActiveFilters(query())).toBe(0);
    expect(countActiveFilters(query({ pool: true, maxPrice: 3000 }))).toBe(2);
    expect(countActiveFilters(query({ destination: "Sopot", adults: 4 }))).toBe(0);
  });
});
