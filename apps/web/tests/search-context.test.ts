import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EMPTY_QUERY, buildSearchParams, parseSearchQuery } from "../lib/search";

const ROOT = join(__dirname, "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * Search → Property → Search, without losing what the Guest already said.
 *
 * The URL is the only carrier: `localStorage` never overrides it, and no
 * component keeps a private copy. These tests pin both halves of the round
 * trip and the two call sites that perform it.
 */

const FULL = {
  ...EMPTY_QUERY,
  destination: "Gdansk",
  checkIn: "2026-09-12",
  checkOut: "2026-09-16",
  adults: 3,
  children: 1,
  propertyTypes: ["apartment" as const],
  minBedrooms: 2,
  pool: true,
  minRating: 8,
  maxPrice: 900,
  amenities: ["WIFI" as const],
  sort: "price-asc" as const,
  bounds: { west: 18.5, south: 54.3, east: 18.7, north: 54.5 },
};

describe("the search survives a round trip through the URL", () => {
  it("comes back identical", () => {
    expect(parseSearchQuery(buildSearchParams(FULL))).toEqual(FULL);
  });

  it("carries the stay, the guests, the filters and the sort", () => {
    const params = buildSearchParams(FULL);

    expect(params.get("destination")).toBe("Gdansk");
    expect(params.get("checkIn")).toBe("2026-09-12");
    expect(params.get("checkOut")).toBe("2026-09-16");
    expect(params.get("adults")).toBe("3");
    expect(params.get("children")).toBe("1");
    expect(params.get("type")).toBe("apartment");
    expect(params.get("pool")).toBe("true");
    expect(params.get("sort")).toBe("price-asc");
    expect(params.get("bbox")).not.toBeNull();
  });

  it("says nothing it was not told — defaults stay out of the address bar", () => {
    expect(buildSearchParams(EMPTY_QUERY).toString()).toBe("");
  });

  it("changing only the stay leaves every other choice alone", () => {
    const changed = parseSearchQuery(
      buildSearchParams({ ...FULL, checkIn: "2026-10-02", checkOut: "2026-10-05" }),
    );

    expect(changed.checkIn).toBe("2026-10-02");
    expect(changed.checkOut).toBe("2026-10-05");
    expect(changed.sort).toBe("price-asc");
    expect(changed.propertyTypes).toEqual(["apartment"]);
    expect(changed.minRating).toBe(8);
  });
});

describe("Search hands the Listing the whole query", () => {
  const experience = source("components/search/SearchExperience.tsx");

  it("does not strip it down to the stay", () => {
    expect(experience).toContain("buildSearchParams(query).toString()");
    // The old version rebuilt the link from EMPTY_QUERY, which dropped the
    // destination, the filters and the sort on the way to the Listing.
    expect(experience).not.toMatch(/EMPTY_QUERY/);
  });
});

describe("the Listing hands it back", () => {
  const page = source("app/property/[id]/page.tsx");
  const back = source("components/property/BackToSearchLink.tsx");

  it("rebuilds the results URL from the query it arrived with", () => {
    expect(page).toContain("buildSearchParams({");
    expect(page).toContain("destination: query.destination || property.city");
  });

  it("reads the live URL, so dates changed on the page travel back too", () => {
    expect(back).toContain('"use client"');
    expect(back).toContain("useSearchParams");
    expect(back).toContain("parseSearchQuery");
    expect(back).toContain("buildSearchParams");
  });

  it("falls back to the Property's own city for a Guest who came from a link", () => {
    expect(back).toContain("query.destination || city");
  });
});

describe("the Listing does not ask twice for what the URL already says", () => {
  const page = source("app/property/[id]/page.tsx");

  it("prefills the booking box from the parsed query", () => {
    expect(page).toContain("<BookingBox");
    expect(page).toMatch(/checkIn=\{query\.checkIn\}/);
    expect(page).toMatch(/checkOut=\{query\.checkOut\}/);
    expect(page).toMatch(/adults=\{query\.adults\}/);
    expect(page).toMatch(/childrenCount=\{query\.children\}/);
  });
});
