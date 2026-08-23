"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "rezervio:favorites";
const EMPTY: string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: string[] = EMPTY;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Re-parse only when the stored string actually changed, so the snapshot
    // stays referentially stable for useSyncExternalStore.
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = raw ? (JSON.parse(raw) as string[]) : EMPTY;
    }
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Local-only favourites shared by every card on the page. No backend, no
 * account — just localStorage, with an in-memory fallback when it is blocked.
 */
export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, () => EMPTY);

  const toggleFavorite = useCallback((id: string) => {
    const current = read();
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];

    cachedValue = next;
    cachedRaw = JSON.stringify(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, cachedRaw);
    } catch {
      // Storage unavailable — favourites live for this page view only.
    }

    listeners.forEach((listener) => listener());
  }, []);

  return { favorites, toggleFavorite };
}
