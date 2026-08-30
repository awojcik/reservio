import { createApiClient, type SearchParams } from "@rezervio/api-client";

import { BEACH_RADIUS } from "./search";
import type { SearchQuery } from "./types";

/**
 * The browser talks to the public URL; Next.js on the server can use an
 * internal address, which keeps the API reachable even when it is not exposed
 * publicly. Both default to local development.
 */
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/**
 * Browser client. `credentials: "include"` is what carries the HttpOnly
 * session cookie to the API, which lives on another port; the app itself never
 * reads or decodes it (milestone 02 §62).
 */
export const apiClient = createApiClient(PUBLIC_API_URL, { credentials: "include" });

/**
 * Server-side clients live in `lib/api-server.ts`. This module is imported by
 * Client Components too, so it must never reach for `next/headers`.
 */

const SORT_TO_API: Record<SearchQuery["sort"], NonNullable<SearchParams["sort"]>> = {
  recommended: "RECOMMENDED",
  "price-asc": "LOWEST_PRICE",
  "rating-desc": "HIGHEST_RATING",
  "beach-asc": "CLOSEST_TO_BEACH",
  "best-value": "BEST_VALUE",
};

const TYPE_TO_API = {
  apartment: "APARTMENT",
  house: "HOUSE",
  villa: "VILLA",
  studio: "STUDIO",
} as const;

/**
 * URL state (unchanged, human-readable) → API contract (stable domain values).
 * Money crosses the boundary here too: the URL keeps złoty, the API speaks
 * minor units.
 */
export function toSearchParams(query: SearchQuery): SearchParams {
  const params: SearchParams = {
    destination: query.destination || undefined,
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    adults: query.adults,
    children: query.children,
    sort: SORT_TO_API[query.sort],
  };

  if (query.propertyTypes.length) {
    params.propertyType = query.propertyTypes.map((type) => TYPE_TO_API[type]);
  }
  if (query.minBedrooms) params.minBedrooms = query.minBedrooms;
  if (query.pool) params.pool = true;
  if (query.parking) params.parking = true;
  if (query.minRating) params.minRating = query.minRating;
  if (query.maxPrice !== null) params.maxPrice = query.maxPrice * 100;

  if (query.nearBeach) params.maxBeachDistanceMeters = BEACH_RADIUS;
  if (query.amenities.length) params.amenities = query.amenities;

  if (query.bounds) {
    params.north = query.bounds.north;
    params.south = query.bounds.south;
    params.east = query.bounds.east;
    params.west = query.bounds.west;
  }

  return params;
}
