import type {
  Amenity,
  MapBounds,
  PropertyType,
  SearchQuery,
  SortOption,
} from "./types";

/**
 * URL state only. Filtering, sorting and pricing now happen in PostgreSQL —
 * this module just translates between the address bar and a typed query, so a
 * reload or a shared link reproduces the exact same request.
 */

/** Demo stay: 12–16 September. Kept constant so server and client agree. */
export const DEFAULT_CHECK_IN = "2026-09-12";
export const DEFAULT_CHECK_OUT = "2026-09-16";
export const DEFAULT_DESTINATION = "Gdańsk";

export const PROPERTY_TYPES: PropertyType[] = [
  "apartment",
  "house",
  "villa",
  "studio",
];

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recommended", label: "Polecane" },
  { value: "price-asc", label: "Najniższa cena" },
  { value: "rating-desc", label: "Najwyższa ocena" },
  { value: "beach-asc", label: "Najbliżej plaży" },
  { value: "best-value", label: "Best value" },
];

export const EMPTY_QUERY: SearchQuery = {
  destination: DEFAULT_DESTINATION,
  checkIn: DEFAULT_CHECK_IN,
  checkOut: DEFAULT_CHECK_OUT,
  adults: 2,
  children: 2,
  propertyTypes: [],
  minBedrooms: 0,
  pool: false,
  parking: false,
  nearBeach: false,
  minRating: 0,
  maxPrice: null,
  amenities: [],
  sort: "recommended",
  bounds: null,
};

/** Distance (in meters) that counts as "close to the beach". */
export const BEACH_RADIUS = 500;

type ParamsLike = Pick<URLSearchParams, "get">;

function num(params: ParamsLike, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(params: ParamsLike, key: string): boolean {
  return params.get(key) === "true";
}

function list(params: ParamsLike, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw.split(",").filter(Boolean);
}

export function parseSearchQuery(params: ParamsLike): SearchQuery {
  const boundsRaw = list(params, "bbox").map(Number);
  const bounds: MapBounds | null =
    boundsRaw.length === 4 && boundsRaw.every((n) => Number.isFinite(n))
      ? {
          west: boundsRaw[0],
          south: boundsRaw[1],
          east: boundsRaw[2],
          north: boundsRaw[3],
        }
      : null;

  const sortRaw = params.get("sort");
  const sort = SORT_OPTIONS.some((option) => option.value === sortRaw)
    ? (sortRaw as SortOption)
    : "recommended";

  return {
    destination: params.get("destination") || DEFAULT_DESTINATION,
    checkIn: params.get("checkIn") || DEFAULT_CHECK_IN,
    checkOut: params.get("checkOut") || DEFAULT_CHECK_OUT,
    adults: Math.max(1, Math.round(num(params, "adults", 2))),
    children: Math.max(0, Math.round(num(params, "children", 2))),
    propertyTypes: list(params, "type").filter((value): value is PropertyType =>
      PROPERTY_TYPES.includes(value as PropertyType),
    ),
    minBedrooms: Math.max(0, Math.round(num(params, "bedrooms", 0))),
    pool: bool(params, "pool"),
    parking: bool(params, "parking"),
    nearBeach: bool(params, "beach"),
    minRating: num(params, "rating", 0),
    maxPrice: params.get("maxPrice") ? num(params, "maxPrice", 0) : null,
    amenities: list(params, "amenities") as Amenity[],
    sort,
    bounds,
  };
}

/** Serialises a query back to search params, omitting everything left at default. */
export function buildSearchParams(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.destination) params.set("destination", query.destination);
  if (query.checkIn !== DEFAULT_CHECK_IN) params.set("checkIn", query.checkIn);
  if (query.checkOut !== DEFAULT_CHECK_OUT)
    params.set("checkOut", query.checkOut);
  if (query.adults !== 2) params.set("adults", String(query.adults));
  if (query.children !== 2) params.set("children", String(query.children));
  if (query.propertyTypes.length) params.set("type", query.propertyTypes.join(","));
  if (query.minBedrooms) params.set("bedrooms", String(query.minBedrooms));
  if (query.pool) params.set("pool", "true");
  if (query.parking) params.set("parking", "true");
  if (query.nearBeach) params.set("beach", "true");
  if (query.minRating) params.set("rating", String(query.minRating));
  if (query.maxPrice !== null) params.set("maxPrice", String(query.maxPrice));
  if (query.amenities.length) params.set("amenities", query.amenities.join(","));
  if (query.sort !== "recommended") params.set("sort", query.sort);
  if (query.bounds) {
    const { west, south, east, north } = query.bounds;
    params.set(
      "bbox",
      [west, south, east, north].map((n) => n.toFixed(5)).join(","),
    );
  }

  return params;
}

/** Number of filter chips that are currently narrowing the results. */
export function countActiveFilters(query: SearchQuery): number {
  return [
    query.propertyTypes.length > 0,
    query.minBedrooms > 0,
    query.pool,
    query.parking,
    query.nearBeach,
    query.minRating > 0,
    query.maxPrice !== null,
    query.amenities.length > 0,
    query.bounds !== null,
  ].filter(Boolean).length;
}
