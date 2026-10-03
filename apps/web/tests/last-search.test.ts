import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLastSearch,
  readLastSearch,
  resetLastSearchCache,
  writeLastSearch,
} from "@/lib/last-search";
import { EMPTY_QUERY, parseSearchQuery } from "@/lib/search";
import type { SearchQuery } from "@/lib/types";

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  ...EMPTY_QUERY,
  ...overrides,
});

/** A localStorage that behaves, and one that refuses everything. */
function installStorage(store: Record<string, string> = {}) {
  const storage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };

  vi.stubGlobal("window", { localStorage: storage });
  return store;
}

beforeEach(() => {
  resetLastSearchCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The last search is a convenience and the *lowest* priority source of state.
 * These tests are mostly about what it must refuse to do (§4).
 */
describe("remembering a search", () => {
  it("round-trips a real search", () => {
    installStorage();

    const original = query({
      destination: "Sopot",
      checkIn: "2026-09-12",
      checkOut: "2026-09-16",
      adults: 3,
      children: 1,
      pool: true,
    });

    writeLastSearch(original);
    expect(readLastSearch()).toEqual(original);
  });

  /**
   * Storing a blank would make "restore my last search" restore nothing — and
   * quietly overwrite a real search made a minute earlier.
   */
  it("refuses to remember a search that says nothing", () => {
    const store = installStorage();

    writeLastSearch(EMPTY_QUERY);
    expect(Object.keys(store)).toHaveLength(0);
    expect(readLastSearch()).toBeNull();

    // Filters alone are not a search either.
    writeLastSearch(query({ pool: true, minRating: 9 }));
    expect(Object.keys(store)).toHaveLength(0);
  });

  it("remembers a destination alone, and a stay alone", () => {
    installStorage();

    writeLastSearch(query({ destination: "Kraków" }));
    expect(readLastSearch()?.destination).toBe("Kraków");

    resetLastSearchCache();
    writeLastSearch(query({ checkIn: "2026-09-12", checkOut: "2026-09-16" }));
    expect(readLastSearch()?.checkIn).toBe("2026-09-12");
  });

  /**
   * Map bounds describe a viewport somebody was panning, not an intent.
   * Restoring them would drop a visitor into a rectangle with no context.
   */
  it("does not remember the map viewport", () => {
    installStorage();

    writeLastSearch(
      query({
        destination: "Gdańsk",
        bounds: { west: 18.55, south: 54.43, east: 18.6, north: 54.46 },
      }),
    );

    expect(readLastSearch()?.bounds).toBeNull();
  });
});

describe("reading a stored search back", () => {
  it("ignores an entry that is not a valid search", () => {
    installStorage({ "rezervio.last-search": "checkIn=wczoraj&sort=nonsense" });
    // Nothing usable survives the parser, so there is nothing to restore.
    expect(readLastSearch()).toBeNull();
  });

  it("ignores an entry written by an older, different shape", () => {
    installStorage({ "rezervio.last-search": '{"destination":"Sopot"}' });
    expect(readLastSearch()).toBeNull();
  });

  it("drops half a stay rather than restoring it", () => {
    installStorage({ "rezervio.last-search": "destination=Sopot&checkIn=2026-09-12" });

    const restored = readLastSearch();
    expect(restored?.destination).toBe("Sopot");
    expect(restored?.checkIn).toBe("");
    expect(restored?.checkOut).toBe("");
  });

  it("returns nothing when there is nothing stored", () => {
    installStorage();
    expect(readLastSearch()).toBeNull();
  });

  /** Private mode, or storage blocked entirely. A convenience may not throw. */
  it("survives storage that refuses to answer", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(readLastSearch()).toBeNull();
    expect(() => writeLastSearch(query({ destination: "Sopot" }))).not.toThrow();
    expect(() => clearLastSearch()).not.toThrow();
  });
});

/**
 * The priority rule, stated as a test.
 *
 * ```text
 * 1. URL query params
 * 2. last search
 * 3. blank
 * ```
 *
 * A shared link that says Kraków must show Kraków on a laptop whose last
 * search was Zakopane — otherwise links cannot be trusted, which costs more
 * than the convenience is worth (§4).
 */
describe("URL beats the remembered search", () => {
  it("uses the URL when it carries a search", () => {
    installStorage({ "rezervio.last-search": "destination=Zakopane" });

    const url = new URLSearchParams("destination=Kraków&checkIn=2026-10-01&checkOut=2026-10-04");
    const fromUrl = parseSearchQuery(url);

    expect(fromUrl.destination).toBe("Kraków");
    // The stored search is still there — it simply does not get a say.
    expect(readLastSearch()?.destination).toBe("Zakopane");
  });

  it("falls back to the remembered search only for a bare URL", () => {
    installStorage({ "rezervio.last-search": "destination=Zakopane" });

    const bare = new URLSearchParams("");
    expect(bare.toString().length).toBe(0);

    // What the search page does in that case, and only in that case.
    const restored = readLastSearch();
    expect(restored?.destination).toBe("Zakopane");
  });

  it("falls back to blank when nothing is remembered", () => {
    installStorage();

    expect(readLastSearch()).toBeNull();
    expect(parseSearchQuery(new URLSearchParams(""))).toEqual(EMPTY_QUERY);
  });
});
