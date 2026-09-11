"use client";

import { useSyncExternalStore } from "react";

import type { SearchQuery } from "./types";
import { EMPTY_QUERY, buildSearchParams, hasSearchCriteria, parseSearchQuery } from "./search";

const KEY = "rezervio.last-search";

/**
 * The last search this browser made.
 *
 * Convenience only, and deliberately the *lowest* priority source of state:
 *
 * ```text
 * 1. URL query params     what the visitor asked for, or was linked to
 * 2. last search          what they asked for previously, on this device
 * 3. blank
 * ```
 *
 * The URL always wins. A shared link that says "Kraków" must show Kraków even
 * on a laptop whose last search was Zakopane — anything else makes links
 * untrustworthy, which is worse than losing a convenience.
 *
 * Stored as a query string rather than JSON so it goes through exactly the same
 * parser the address bar does: one definition of what a valid search is, and a
 * tampered or outdated entry degrades to blank instead of to a broken object.
 */
export function readLastSearch(): SearchQuery | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Private mode, or storage blocked. Not having a convenience is fine.
    return null;
  }

  if (!raw) return null;

  const query = parseSearchQuery(new URLSearchParams(raw));

  // The parser drops anything malformed, so this also rejects an entry written
  // by an older version whose shape no longer means anything.
  return hasSearchCriteria(query) ? query : null;
}

/**
 * Remembers a search — but only one worth repeating.
 *
 * An empty destination with no dates is not a search; storing it would make
 * "restore my last search" restore nothing, and quietly overwrite a real one
 * the visitor made a minute earlier (§4).
 */
export function writeLastSearch(query: SearchQuery): void {
  if (typeof window === "undefined") return;
  if (!hasSearchCriteria(query)) return;

  /*
   * Map bounds are deliberately not remembered. They describe a viewport the
   * visitor was panning around, not an intent, and restoring them would drop
   * somebody into a rectangle they cannot see the edges of.
   */
  const params = buildSearchParams({ ...query, bounds: null });

  try {
    window.localStorage.setItem(KEY, params.toString());
  } catch {
    // Quota or blocked storage: nothing here is worth failing a render over.
  }
}

export function clearLastSearch(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/** The blank query, for a first-time visitor with nothing stored. */
export const BLANK_SEARCH: SearchQuery = EMPTY_QUERY;

/**
 * The remembered search, as an external store.
 *
 * `useSyncExternalStore` rather than an effect that calls `setState`: the
 * server has no localStorage, so its snapshot is `null` and the client's is
 * whatever is stored. React handles that transition itself, and the component
 * never has to reconcile two sources of truth by hand.
 *
 * The snapshot is cached because `getSnapshot` must return a stable reference —
 * parsing on every call would hand React a new object each render and loop.
 */
let snapshot: SearchQuery | null | undefined;

/** Nothing here ever changes while the page is open. */
function subscribe(): () => void {
  return () => undefined;
}

function getSnapshot(): SearchQuery | null {
  if (snapshot === undefined) snapshot = readLastSearch();
  return snapshot;
}

function getServerSnapshot(): SearchQuery | null {
  return null;
}

export function useLastSearch(): SearchQuery | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: drops the cached snapshot so the next read hits storage again. */
export function resetLastSearchCache(): void {
  snapshot = undefined;
}
