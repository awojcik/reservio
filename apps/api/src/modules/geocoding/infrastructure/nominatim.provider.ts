import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  GeocodingUnavailableError,
  isStorableCoordinate,
  type GeocodeAddress,
  type GeocodePrecision,
  type GeocodingProvider,
  type GeocodingResult,
} from "../domain/geocoding-provider";

/**
 * Nominatim — OpenStreetMap's own geocoder.
 *
 * Chosen because it needs no account, no key and no billing relationship, and
 * because it shares its data with the basemap Rezervio already renders
 * (OpenFreeMap serves OSM tiles). A point from one and a tile from the other
 * agree about where a street is, which a mixed pairing would not guarantee.
 *
 * Its usage policy asks for at most one request per second and a User-Agent
 * that identifies the application. Both are reasons this runs on the server
 * rather than in the browser: a browser cannot be rate limited by us and would
 * expose the contact address in every page load.
 */
const NOMINATIM_HOST = "nominatim.openstreetmap.org";
const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const TIMEOUT_MS = 8_000;

/** Polish street prefixes. Nominatim's `street` field wants the name alone. */
const STREET_PREFIX = /^(ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle)\s+/i;

type NominatimPlace = {
  lat?: string;
  lon?: string;
  display_name?: string;
  place_rank?: number;
  addresstype?: string;
};

/**
 * Nominatim's `place_rank`, reduced to the four answers that change behaviour.
 *
 * 30 is a house number, 26 a street, 16 a city. Anything coarser is a region,
 * which is never a Property location.
 */
function toPrecision(place: NominatimPlace): GeocodePrecision {
  const rank = place.place_rank ?? 0;

  if (rank >= 30 || place.addresstype === "building" || place.addresstype === "house") {
    return "EXACT";
  }
  if (rank >= 26) return "STREET";
  if (rank >= 12) return "CITY";
  return "AREA";
}

@Injectable()
export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = "nominatim";
  private readonly logger = new Logger(NominatimGeocodingProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (this.config.get<string>("GEOCODING_BASE_URL") ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
  }

  /**
   * Overridable only so the contract tests can point the real adapter at a
   * local double. Everywhere else it is Nominatim's own host and nothing else.
   */
  private get allowedHosts(): string[] {
    const override = this.config.get<string>("GEOCODING_ALLOWED_HOSTS");
    return override ? override.split(",").map((host) => host.trim()) : [NOMINATIM_HOST];
  }

  /**
   * Nominatim asks that the User-Agent name a real application and a way to
   * reach whoever runs it. A deployment that does not set the contact still
   * identifies itself, which is the part that matters most.
   */
  private get userAgent(): string {
    const contact = (this.config.get<string>("GEOCODING_CONTACT_EMAIL") ?? "").trim();
    return contact ? `Rezervio/0.2 (${contact})` : "Rezervio/0.2";
  }

  /**
   * Structured first, free-form second.
   *
   * The structured query is stricter and gives a better `place_rank`, but it
   * fails outright when one field disagrees with the others — a postcode that
   * does not match the street, say. The free-form pass is what turns that from
   * "no such place" into a usable street-level answer.
   */
  async geocode(address: GeocodeAddress): Promise<GeocodingResult | null> {
    const structured = await this.query(this.structuredParams(address));
    if (structured) return structured;

    const freeform = this.freeformQuery(address);
    return freeform ? this.query(new URLSearchParams({ q: freeform })) : null;
  }

  private structuredParams(address: GeocodeAddress): URLSearchParams {
    const params = new URLSearchParams();

    const street = (address.addressLine1 ?? "").replace(STREET_PREFIX, "").trim();
    if (street) params.set("street", street);
    if (address.postalCode) params.set("postalcode", address.postalCode);

    params.set("city", address.city);
    params.set("countrycodes", address.countryCode.toLowerCase());

    return params;
  }

  /** Everything the Host typed, in one line, for when the strict pass misses. */
  private freeformQuery(address: GeocodeAddress): string {
    return [address.addressLine1, address.postalCode, address.city, address.countryCode]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }

  private async query(params: URLSearchParams): Promise<GeocodingResult | null> {
    params.set("format", "jsonv2");
    params.set("addressdetails", "1");
    params.set("limit", "1");

    const url = `${this.baseUrl}/search?${params.toString()}`;
    if (!this.allowed(url)) {
      throw new GeocodingUnavailableError(
        "Adres serwisu geokodowania nie należy do dozwolonych domen.",
        "URL_NOT_ALLOWED",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": this.userAgent,
          "accept-language": "pl,en",
        },
      });
    } catch (error) {
      throw new GeocodingUnavailableError(
        (error as Error).name === "AbortError"
          ? "Serwis geokodowania nie odpowiedział na czas."
          : "Nie udało się połączyć z serwisem geokodowania.",
        (error as Error).name === "AbortError" ? "GEOCODING_TIMEOUT" : "GEOCODING_UNREACHABLE",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new GeocodingUnavailableError(
        "Serwis geokodowania prosi o zwolnienie tempa.",
        "GEOCODING_RATE_LIMITED",
      );
    }
    if (!response.ok) {
      throw new GeocodingUnavailableError(
        `Serwis geokodowania odpowiedział ${response.status}.`,
        "GEOCODING_FAILED",
      );
    }

    const places = (await response.json().catch(() => null)) as NominatimPlace[] | null;
    const place = Array.isArray(places) ? places[0] : null;
    if (!place) return null;

    const latitude = Number(place.lat);
    const longitude = Number(place.lon);

    /*
     * A response we cannot turn into a storable point is the same as no answer.
     * Passing it on would let a NaN or a `0, 0` reach the Property row, and
     * from there every map in Rezervio.
     */
    if (!isStorableCoordinate(latitude, longitude)) {
      this.logger.warn({ event: "geocoding.unusable_result", provider: this.name });
      return null;
    }

    return {
      latitude: round(latitude),
      longitude: round(longitude),
      precision: toPrecision(place),
      formattedAddress: place.display_name ?? "",
    };
  }

  private allowed(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);

      // Plain HTTP only to a loopback double, and never in production.
      if (parsed.protocol !== "https:") {
        const loopback =
          parsed.protocol === "http:" &&
          ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname) &&
          process.env.NODE_ENV !== "production";
        if (!loopback) return false;
      }

      return this.allowedHosts.some(
        (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
      );
    } catch {
      return false;
    }
  }
}

/** Six decimals is roughly 10 cm — far beyond what a Listing needs. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
