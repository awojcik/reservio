import type { PropertyDetail, PropertySummary } from "@rezervio/api-client";

/**
 * The web app's own vocabulary. Property data itself comes from the API
 * contract — nothing here re-describes what the backend already defines.
 */
export type { PropertyDetail, PropertySummary };

/** Amenity codes are stable domain values, shared verbatim with the API. */
export type Amenity =
  | "POOL"
  | "PARKING"
  | "WIFI"
  | "KITCHEN"
  | "WASHING_MACHINE"
  | "AIR_CONDITIONING"
  | "BALCONY"
  | "TERRACE"
  | "SAUNA"
  | "SEA_VIEW"
  | "PET_FRIENDLY"
  | "WORKSPACE"
  | "ELEVATOR"
  | "FIREPLACE"
  | "BBQ";

/** Lower-case in the URL for readability; mapped to domain values in lib/api.ts. */
export type PropertyType = "apartment" | "house" | "villa" | "studio";

export type SortOption =
  | "recommended"
  | "price-asc"
  | "rating-desc"
  | "beach-asc"
  | "best-value";

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** The full, URL-serialisable state of the search experience. */
export type SearchQuery = {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  propertyTypes: PropertyType[];
  minBedrooms: number;
  pool: boolean;
  parking: boolean;
  nearBeach: boolean;
  minRating: number;
  /** Maximum total stay price in złoty, as typed by the guest. */
  maxPrice: number | null;
  amenities: Amenity[];
  sort: SortOption;
  bounds: MapBounds | null;
};
