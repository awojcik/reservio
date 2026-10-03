/**
 * Turning an address into a point on the map.
 *
 * One small interface, one adapter. Not a multi-provider framework: the second
 * provider is the moment to generalise, and until it exists a registry would be
 * indirection with nothing on the other side of it.
 */
export const GEOCODING_PROVIDER = Symbol("GEOCODING_PROVIDER");

/** What a Host types into the address form. */
export type GeocodeAddress = {
  addressLine1: string | null;
  postalCode: string | null;
  city: string;
  district: string | null;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
};

/**
 * How closely the answer matches what was asked.
 *
 * The distinction is the whole reason this is not just a lat/lon pair: a point
 * that is merely "somewhere in Gdańsk" must not be silently stored as the
 * Property's location, and the Host has to be told to move the marker
 * themselves.
 */
export const GEOCODE_PRECISIONS = ["EXACT", "STREET", "CITY", "AREA"] as const;
export type GeocodePrecision = (typeof GEOCODE_PRECISIONS)[number];

export type GeocodingResult = {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
  /** What the provider thinks it found. Shown so a Host can spot a mismatch. */
  formattedAddress: string;
};

export interface GeocodingProvider {
  readonly name: string;

  /** Null when the provider is reachable but knows no such place. */
  geocode(address: GeocodeAddress): Promise<GeocodingResult | null>;
}

/** The provider is unreachable, rate limiting us, or answering nonsense. */
export class GeocodingUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GeocodingUnavailableError";
  }
}

/**
 * A point Rezervio is willing to store.
 *
 * `0, 0` is in the Gulf of Guinea and is what a provider returns when it has
 * parsed nothing — accepting it would put a Property in the ocean and make the
 * search map fit its bounds around Africa. NaN comes from a response whose
 * numbers were strings that did not parse.
 */
export function isStorableCoordinate(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;

  // Null Island. No Property is there, and every provider bug points at it.
  return !(Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6);
}
