/**
 * The canonical Amenity vocabulary — one source of truth for the seed, the
 * Host editor and the public filters. Codes are stable domain values; the
 * Polish labels are presentation and live in the web app (domain language §2).
 */
export const AMENITY_CODES = [
  "AIR_CONDITIONING",
  "BALCONY",
  "BBQ",
  "ELEVATOR",
  "FIREPLACE",
  "KITCHEN",
  "PARKING",
  "PET_FRIENDLY",
  "POOL",
  "SAUNA",
  "SEA_VIEW",
  "TERRACE",
  "WASHING_MACHINE",
  "WIFI",
  "WORKSPACE",
] as const;

export type AmenityCode = (typeof AMENITY_CODES)[number];

const CODES = new Set<string>(AMENITY_CODES);

export function isAmenityCode(value: string): value is AmenityCode {
  return CODES.has(value);
}
