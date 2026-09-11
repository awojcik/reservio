"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, type GeocodePrecision } from "@rezervio/api-client";

import { apiClient } from "@/lib/api";

export type GeocodeAddressInput = {
  addressLine1: string;
  postalCode: string;
  city: string;
  countryCode: string;
};

export type GeocodeState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "found";
      precision: GeocodePrecision;
      formattedAddress: string;
      latitude: number;
      longitude: number;
      /**
       * Whether the marker actually moved to this point. False when the
       * Property already had one: the editor then offers the move instead of
       * making it, so a found address is never a silent no-op on the map.
       */
      applied: boolean;
    }
  | { status: "not-found" }
  | { status: "error"; message: string };

/** Long enough that typing a street does not fire a request per letter. */
export const DEBOUNCE_MS = 900;

/**
 * Below this there is nothing worth asking about: a country code alone, or a
 * city of one letter, produces an answer the size of a voivodeship.
 */
export function isAskable(address: GeocodeAddressInput): boolean {
  return address.city.trim().length >= 2 && address.countryCode.trim().length === 2;
}

/**
 * The identity of an address.
 *
 * Case and spacing do not change where a place is, so they must not count as a
 * change worth another request (§7).
 */
export function fingerprint(address: GeocodeAddressInput): string {
  return [address.addressLine1, address.postalCode, address.city, address.countryCode]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

/**
 * Whether an automatic lookup is worth making.
 *
 * Exported and pure so the rule can be tested without a DOM: it is the whole
 * of "no request per keystroke, and none at all for an address we already
 * asked about" (§7).
 */
export function shouldLookUp(
  address: GeocodeAddressInput,
  alreadyAsked: string | null,
): boolean {
  return isAskable(address) && alreadyAsked !== fingerprint(address);
}

/**
 * Whether a found point may move the marker.
 *
 * An automatic lookup proposes a location for a Property that has none. It
 * does **not** undo a marker the Host dragged into place — only an explicit
 * "find it again" does that (§1).
 */
export function shouldApplyResult(force: boolean, hasCoordinates: boolean): boolean {
  return force || !hasCoordinates;
}

/**
 * Address → point, while a Host types.
 *
 * Three things this has to get right (§7):
 *
 * - **Debounce.** A request per keystroke would be a request per letter of a
 *   street name, against a service the whole OpenStreetMap community shares.
 * - **No repeat for an unchanged address.** Reopening the editor, or editing
 *   the price, must not re-ask a question already answered.
 * - **Never overwrite a manual correction.** Once the Host drags the marker,
 *   that point is the answer; a later lookup for the same address must not
 *   silently move it back.
 */
export function useGeocodedLocation({
  address,
  hasCoordinates,
  onResolved,
  enabled,
}: {
  address: GeocodeAddressInput;
  /** True once the Property has a point, however it was arrived at. */
  hasCoordinates: boolean;
  onResolved: (latitude: number, longitude: number) => void;
  enabled: boolean;
}): GeocodeState & { lookupNow: () => void } {
  const [state, setState] = useState<GeocodeState>({ status: "idle" });

  const key = fingerprint(address);

  // What has already been asked, so an unchanged address is never re-sent.
  const askedRef = useRef<string | null>(null);
  const onResolvedRef = useRef(onResolved);
  const hasCoordinatesRef = useRef(hasCoordinates);

  useEffect(() => {
    onResolvedRef.current = onResolved;
    hasCoordinatesRef.current = hasCoordinates;
  }, [onResolved, hasCoordinates]);

  const run = useCallback(
    async (input: GeocodeAddressInput, signal: AbortSignal, force: boolean) => {
      setState({ status: "loading" });

      try {
        const result = await apiClient.geocodeAddress({
          addressLine1: input.addressLine1.trim() || undefined,
          postalCode: input.postalCode.trim() || undefined,
          city: input.city.trim(),
          countryCode: input.countryCode.trim().toUpperCase(),
          // "Find it again" disagrees with the last answer, so it must not be
          // served the last answer back out of a cache.
          ...(force ? { refresh: true } : {}),
        });

        if (signal.aborted) return;

        if (!result.found || result.latitude === null || result.longitude === null) {
          setState({ status: "not-found" });
          return;
        }

        /*
         * A Property that already has a point keeps it unless the Host asked
         * for this lookup explicitly. Automatic geocoding proposes a location
         * for one that has none; it does not undo a marker somebody dragged
         * into place (§1).
         */
        const applied = shouldApplyResult(force, hasCoordinatesRef.current);

        setState({
          status: "found",
          precision: (result.precision ?? "AREA") as GeocodePrecision,
          formattedAddress: result.formattedAddress ?? "",
          latitude: result.latitude,
          longitude: result.longitude,
          applied,
        });

        if (applied) onResolvedRef.current(result.latitude, result.longitude);
      } catch (error) {
        if (signal.aborted) return;

        const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
        setState({
          status: "error",
          message: body?.message ?? "Nie udało się sprawdzić adresu.",
        });
      }
    },
    [],
  );

  // Automatic lookup: debounced, and only for an address nobody has asked about.
  useEffect(() => {
    if (!enabled || !shouldLookUp(address, askedRef.current)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      askedRef.current = key;
      void run(address, controller.signal, false);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `address` is rebuilt every render; `key` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, run]);

  /** "Find it again" — deliberate, so it overrides a manual correction. */
  const lookupNow = useCallback(() => {
    if (!isAskable(address)) return;

    const controller = new AbortController();
    askedRef.current = key;
    void run(address, controller.signal, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);

  return { ...state, lookupNow };
}
