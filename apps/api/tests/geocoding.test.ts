import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GeocodingUnavailableError,
  isStorableCoordinate,
} from "../src/modules/geocoding/domain/geocoding-provider";
import { GeocodingService, cacheKey } from "../src/modules/geocoding/geocoding.service";
import { NominatimGeocodingProvider } from "../src/modules/geocoding/infrastructure/nominatim.provider";
import { startMockProvider, type MockProvider } from "./helpers/mock-provider-server";

/**
 * The geocoder, end to end below the network boundary.
 *
 * The adapter under test is the real one; only the service it calls is local.
 * That is the layer worth covering here — a mistyped query parameter or a
 * misread `place_rank` would not fail anywhere else until a Host noticed their
 * Property was in the wrong district (§8).
 */
let mock: MockProvider;

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function provider(): NominatimGeocodingProvider {
  return new NominatimGeocodingProvider(
    config({ GEOCODING_BASE_URL: mock.origin, GEOCODING_ALLOWED_HOSTS: mock.host }),
  );
}

const ADDRESS = {
  addressLine1: "ul. Jelitkowska 8",
  postalCode: "80-342",
  city: "Gdańsk",
  district: "Jelitkowo",
  countryCode: "PL",
};

/** One Nominatim place, in the shape the service actually reads. */
function place(overrides: Record<string, unknown> = {}) {
  return {
    lat: "54.426395",
    lon: "18.592277",
    display_name: "Jelitkowska 8, Jelitkowo, Gdańsk, 80-342, Polska",
    place_rank: 30,
    addresstype: "building",
    ...overrides,
  };
}

beforeAll(async () => {
  mock = await startMockProvider();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

describe("address → latitude/longitude", () => {
  it("asks the documented structured query and returns the point", async () => {
    mock.on("GET", "/search", () => ({ status: 200, body: [place()] }));

    const result = await provider().geocode(ADDRESS);

    expect(result).toEqual({
      latitude: 54.426395,
      longitude: 18.592277,
      precision: "EXACT",
      formattedAddress: "Jelitkowska 8, Jelitkowo, Gdańsk, 80-342, Polska",
    });

    const query = new URLSearchParams(mock.requests[0].path.split("?")[1]);
    // The Polish street prefix is dropped: Nominatim's `street` wants the name.
    expect(query.get("street")).toBe("Jelitkowska 8");
    expect(query.get("city")).toBe("Gdańsk");
    expect(query.get("postalcode")).toBe("80-342");
    expect(query.get("countrycodes")).toBe("pl");
    expect(query.get("format")).toBe("jsonv2");
  });

  it("identifies itself, as the provider's usage policy asks", async () => {
    mock.on("GET", "/search", () => ({ status: 200, body: [place()] }));

    await new NominatimGeocodingProvider(
      config({
        GEOCODING_BASE_URL: mock.origin,
        GEOCODING_ALLOWED_HOSTS: mock.host,
        GEOCODING_CONTACT_EMAIL: "kontakt@rezervio.pl",
      }),
    ).geocode(ADDRESS);

    expect(mock.requests[0].headers["user-agent"]).toBe(
      "Rezervio/0.2 (kontakt@rezervio.pl)",
    );
  });

  /**
   * `place_rank` is the difference between a Property location and a pin in
   * the middle of a city. The editor tells the Host to move the marker for
   * anything coarser than a street.
   */
  it("reads the precision the provider reports", async () => {
    const cases: [number, string | undefined, string][] = [
      [30, "building", "EXACT"],
      [26, "road", "STREET"],
      [16, "city", "CITY"],
      [8, "state", "AREA"],
    ];

    for (const [rank, addresstype, expected] of cases) {
      mock.reset();
      mock.on("GET", "/search", () => ({
        status: 200,
        body: [place({ place_rank: rank, addresstype })],
      }));

      const result = await provider().geocode(ADDRESS);
      expect(result?.precision).toBe(expected);
    }
  });

  /**
   * The strict query fails outright when one field disagrees with another —
   * a postcode that does not match the street, most often. Falling back is
   * what turns that from "no such place" into a usable answer.
   */
  it("falls back to a free-form query when the structured one finds nothing", async () => {
    let call = 0;
    mock.on("GET", "/search", () => {
      call += 1;
      return {
        status: 200,
        body: call === 1 ? [] : [place({ place_rank: 26, addresstype: "road" })],
      };
    });

    const result = await provider().geocode(ADDRESS);

    expect(result?.precision).toBe("STREET");
    expect(mock.requests).toHaveLength(2);

    const fallback = new URLSearchParams(mock.requests[1].path.split("?")[1]);
    expect(fallback.get("q")).toBe("ul. Jelitkowska 8, 80-342, Gdańsk, PL");
    expect(fallback.get("street")).toBeNull();
  });

  it("returns null when the provider genuinely knows no such place", async () => {
    mock.on("GET", "/search", () => ({ status: 200, body: [] }));

    expect(await provider().geocode(ADDRESS)).toBeNull();
  });
});

describe("refusing a point that is not a location", () => {
  /**
   * `0, 0` is in the Gulf of Guinea and is what a geocoder returns when it has
   * parsed nothing. Storing it would put a Property in the ocean and make the
   * search map fit its bounds around Africa (§7).
   */
  it("rejects Null Island, NaN and out-of-range coordinates", () => {
    expect(isStorableCoordinate(54.42, 18.59)).toBe(true);
    expect(isStorableCoordinate(0, 0)).toBe(false);
    expect(isStorableCoordinate(Number.NaN, 18.59)).toBe(false);
    expect(isStorableCoordinate(54.42, Number.NaN)).toBe(false);
    expect(isStorableCoordinate(Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(isStorableCoordinate(91, 18.59)).toBe(false);
    expect(isStorableCoordinate(54.42, 181)).toBe(false);
  });

  it("treats an unusable provider answer as no answer at all", async () => {
    mock.on("GET", "/search", () => ({
      status: 200,
      body: [place({ lat: "0", lon: "0" })],
    }));
    expect(await provider().geocode(ADDRESS)).toBeNull();

    mock.reset();
    mock.on("GET", "/search", () => ({
      status: 200,
      body: [place({ lat: "not-a-number", lon: "18.5" })],
    }));
    expect(await provider().geocode(ADDRESS)).toBeNull();
  });
});

describe("provider failures", () => {
  it("distinguishes rate limiting from a dead service", async () => {
    mock.on("GET", "/search", () => ({ status: 429, body: {} }));
    await expect(provider().geocode(ADDRESS)).rejects.toMatchObject({
      code: "GEOCODING_RATE_LIMITED",
    });

    mock.reset();
    mock.on("GET", "/search", () => ({ status: 503, body: {} }));
    await expect(provider().geocode(ADDRESS)).rejects.toBeInstanceOf(
      GeocodingUnavailableError,
    );
  });

  /** The base URL comes from configuration; following it blindly would be SSRF. */
  it("refuses a host outside the allowlist before making a request", async () => {
    const rogue = new NominatimGeocodingProvider(
      config({
        GEOCODING_BASE_URL: "https://attacker.example",
        GEOCODING_ALLOWED_HOSTS: "nominatim.openstreetmap.org",
      }),
    );

    await expect(rogue.geocode(ADDRESS)).rejects.toMatchObject({
      code: "URL_NOT_ALLOWED",
    });
  });
});

describe("being a good citizen of a shared service", () => {
  /** Case and spacing do not change where a place is. */
  it("treats addresses that differ only in case or spacing as one", () => {
    expect(cacheKey(ADDRESS)).toBe(
      cacheKey({ ...ADDRESS, city: "  GDAŃSK ", addressLine1: "UL.  Jelitkowska 8" }),
    );
    expect(cacheKey(ADDRESS)).not.toBe(cacheKey({ ...ADDRESS, city: "Sopot" }));
  });

  it("asks the provider once for a repeated address", async () => {
    const geocode = vi.fn().mockResolvedValue({
      latitude: 54.42,
      longitude: 18.59,
      precision: "EXACT" as const,
      formattedAddress: "…",
    });

    const service = new GeocodingService({ name: "fake", geocode });

    const first = await service.geocode(ADDRESS);
    const second = await service.geocode(ADDRESS);

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ found: true, cached: false });
    expect(second).toMatchObject({ found: true, cached: true });

    // A different address is a different question.
    await service.geocode({ ...ADDRESS, city: "Sopot" });
    expect(geocode).toHaveBeenCalledTimes(2);
  });

  it("absorbs a burst of misses while somebody is still typing", async () => {
    const geocode = vi.fn().mockResolvedValue(null);
    const service = new GeocodingService({ name: "fake", geocode });

    expect(await service.geocode(ADDRESS)).toEqual({ found: false });
    expect(await service.geocode(ADDRESS)).toEqual({ found: false });
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  /**
   * A miss is not a fact about the address — it is a fact about one answer.
   * A throttled provider returns an empty list rather than an error, and OSM
   * data improves. Remembering "no such place" for a day turned one bad second
   * into a Host who could not geocode their Property until the process
   * restarted.
   */
  it("forgets a miss within seconds, unlike a found point", async () => {
    const geocode = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({
      latitude: 52.192688,
      longitude: 20.987972,
      precision: "EXACT" as const,
      formattedAddress: "4, Przejazd, Warszawa",
    });

    const service = new GeocodingService({ name: "fake", geocode });

    expect(await service.geocode(ADDRESS)).toEqual({ found: false });

    // Six seconds later the same address is asked about again, and answered.
    vi.setSystemTime(new Date(Date.now() + 6_000));
    expect(await service.geocode(ADDRESS)).toMatchObject({ found: true, cached: false });
    expect(geocode).toHaveBeenCalledTimes(2);

    // A found point, by contrast, is kept.
    vi.setSystemTime(new Date(Date.now() + 60_000));
    expect(await service.geocode(ADDRESS)).toMatchObject({ found: true, cached: true });
    expect(geocode).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  /**
   * "Find it again" exists to disagree with the last answer. Serving that
   * answer back out of memory makes the button do nothing at all — which is
   * exactly what a Host hits when a transient miss got cached.
   */
  it("skips the cache for an explicit refresh", async () => {
    const geocode = vi.fn().mockResolvedValue({
      latitude: 52.192688,
      longitude: 20.987972,
      precision: "EXACT" as const,
      formattedAddress: "4, Przejazd, Warszawa",
    });

    const service = new GeocodingService({ name: "fake", geocode });

    await service.geocode(ADDRESS);
    expect(await service.geocode(ADDRESS)).toMatchObject({ cached: true });
    expect(geocode).toHaveBeenCalledTimes(1);

    expect(await service.geocode(ADDRESS, { refresh: true })).toMatchObject({
      cached: false,
    });
    expect(geocode).toHaveBeenCalledTimes(2);
  });

  /**
   * The provider allows one request per second. Serialising here rather than
   * hoping the traffic is thin is the difference between being a good citizen
   * and being blocked.
   */
  it("never has two provider calls in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;

    const geocode = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return null;
    });

    const service = new GeocodingService({ name: "fake", geocode });

    vi.useFakeTimers();
    const all = Promise.all([
      service.geocode({ ...ADDRESS, city: "A" }),
      service.geocode({ ...ADDRESS, city: "B" }),
      service.geocode({ ...ADDRESS, city: "C" }),
    ]);
    await vi.runAllTimersAsync();
    await all;
    vi.useRealTimers();

    expect(peak).toBe(1);
    expect(geocode).toHaveBeenCalledTimes(3);
  });

  /** One failure must not block everyone queued behind it. */
  it("keeps serving after a provider error", async () => {
    const geocode = vi
      .fn()
      .mockRejectedValueOnce(new GeocodingUnavailableError("down", "GEOCODING_FAILED"))
      .mockResolvedValue(null);

    const service = new GeocodingService({ name: "fake", geocode });

    await expect(service.geocode({ ...ADDRESS, city: "A" })).rejects.toThrow();
    await expect(service.geocode({ ...ADDRESS, city: "B" })).resolves.toEqual({
      found: false,
    });
  });
});
