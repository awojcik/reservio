"use client";

import { ApiError, type PropertySummary } from "@rezervio/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiClient, toSearchParams } from "@/lib/api";
import type { SearchQuery } from "@/lib/types";

type Snapshot = {
  /** Which request this result belongs to. */
  key: string;
  items: PropertySummary[];
  total: number;
  status: "ready" | "error";
  error: string | null;
};

export type SearchState = {
  items: PropertySummary[];
  total: number;
  status: "loading" | "ready" | "error";
  error: string | null;
  retry: () => void;
};

/**
 * Results always come from the API — there is no local fallback on purpose, so
 * a backend problem is visible immediately instead of being masked by stale
 * client-side data.
 *
 * "Loading" is derived rather than stored: whenever the newest snapshot belongs
 * to an older request, the hook is by definition still fetching. That keeps the
 * effect free of synchronous setState and cannot drift out of sync.
 */
export function useSearchResults(query: SearchQuery): SearchState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // The query object is rebuilt from the URL on every render, so requests are
  // keyed by their serialised parameters; `attempt` makes a retry a new key.
  const params = useMemo(() => toSearchParams(query), [query]);
  const paramsJson = JSON.stringify(params);
  const key = `${paramsJson}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();

    apiClient
      .searchProperties(JSON.parse(paramsJson), { signal: controller.signal })
      .then((response) => {
        setSnapshot({
          key,
          items: response.items,
          total: response.total,
          status: "ready",
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSnapshot({
          key,
          items: [],
          total: 0,
          status: "error",
          error: error instanceof ApiError ? error.message : "Nie udało się pobrać ofert.",
        });
      });

    return () => controller.abort();
  }, [key, paramsJson]);

  const current = snapshot?.key === key ? snapshot : null;

  return {
    items: current?.items ?? [],
    total: current?.total ?? 0,
    status: current?.status ?? "loading",
    error: current?.error ?? null,
    retry,
  };
}
