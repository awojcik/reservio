import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  GEOCODING_PROVIDER,
  type GeocodeAddress,
  type GeocodingProvider,
  type GeocodingResult,
} from "./domain/geocoding-provider";

export type GeocodeOutcome =
  | { found: true; result: GeocodingResult; cached: boolean }
  | { found: false };

/** How long a found point stays good. Streets do not move. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a *miss* stays good — deliberately almost no time at all.
 *
 * A miss is not a fact about the address, it is a fact about one answer: a
 * throttled provider returns an empty list rather than an error, and OSM data
 * improves. Remembering "no such place" for a day turns one bad second into a
 * Host who cannot geocode their Property until the process restarts, with a
 * "find it again" button that does nothing.
 *
 * A few seconds is still enough to absorb the burst a debounced form produces
 * while somebody finishes typing, which is all the miss cache was ever for.
 */
const MISS_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 500;

/**
 * Geocoding, with the two things the provider's usage policy asks for.
 *
 * **A cache**, because the same address is looked up again every time a Host
 * reopens the editor and re-saves without touching the location, and asking a
 * free service the same question twice is rude.
 *
 * **A queue**, because Nominatim allows one request per second. Serialising
 * here rather than hoping the traffic is thin is the difference between being
 * a good citizen and being blocked.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, { at: number; result: GeocodingResult | null }>();

  /** The tail of the request chain; a new call waits on it, then extends it. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    @Inject(GEOCODING_PROVIDER) private readonly provider: GeocodingProvider,
  ) {}

  /**
   * `refresh` skips the cache entirely.
   *
   * It is what an explicit "find it again" needs: the whole point of pressing
   * that button is disagreeing with the last answer, and serving it back from
   * memory makes the button a no-op.
   */
  async geocode(
    address: GeocodeAddress,
    options: { refresh?: boolean } = {},
  ): Promise<GeocodeOutcome> {
    const key = cacheKey(address);
    const hit = options.refresh ? undefined : this.cache.get(key);

    if (hit && Date.now() - hit.at < (hit.result ? CACHE_TTL_MS : MISS_TTL_MS)) {
      return hit.result ? { found: true, result: hit.result, cached: true } : { found: false };
    }

    const result = await this.serialise(() => this.provider.geocode(address));
    this.remember(key, result);

    this.logger.log({
      event: "geocoding.lookup",
      provider: this.provider.name,
      // The address itself is not logged: it is a Host's home in many cases.
      found: result !== null,
      precision: result?.precision ?? null,
    });

    return result ? { found: true, result, cached: false } : { found: false };
  }

  /**
   * One provider call at a time, at most one per second.
   *
   * Chaining onto the previous promise rather than holding a lock keeps this
   * correct without a library: every caller awaits the tail, and the tail is
   * only ever extended.
   */
  private async serialise<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + 1_000 - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      this.lastRequestAt = Date.now();
      return work();
    });

    // A failure must not poison the chain for everyone queued behind it.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Bounded, oldest-first. A geocoder cache is a convenience, not a store —
   * and a miss is remembered for seconds, not for a day (see `MISS_TTL_MS`).
   */
  private remember(key: string, result: GeocodingResult | null): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), result });
  }
}

/**
 * The identity of an address for cache purposes.
 *
 * Case and surrounding whitespace do not change where a place is, so they must
 * not produce a second lookup.
 */
export function cacheKey(address: GeocodeAddress): string {
  return [
    address.addressLine1,
    address.postalCode,
    address.city,
    address.countryCode,
  ]
    .map((part) => (part ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}
