"use client";

import maplibregl from "maplibre-gl";
import type {
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker as MapMarker,
} from "maplibre-gl";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAP_STYLE_URL,
  prefersReducedMotion,
} from "./mapStyle";
import type { PropertySummary } from "@rezervio/api-client";

import { formatAmountMinor } from "@/lib/format";
import type { MapBounds } from "@/lib/types";

type PropertyMapProps = {
  results: PropertySummary[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onSearchArea: (bounds: MapBounds) => void;
  /**
   * Changing this refits the viewport to the results — it carries the search
   * destination, and is null while the user is browsing by map area (then the
   * viewport is theirs to control).
   */
  fitKey: string | null;
  /** The stay with the largest saving, marked in lime. */
  bestValueId?: string | null;
};

type MarkerEntry = {
  marker: MapMarker;
  element: HTMLButtonElement;
};

/** Colours live in globals.css (.map-marker) — this only picks the state. */
function markerState(active: boolean, bestValue: boolean): string {
  if (active) return "active";
  return bestValue ? "value" : "default";
}

export default function PropertyMap({
  results,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onSearchArea,
  fitKey,
  bestValueId = null,
}: PropertyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const resultsRef = useRef(results);
  const fittedKeyRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showAreaSearch, setShowAreaSearch] = useState(false);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  /**
   * Map initialisation fails synchronously inside the effect; deferring the
   * state update keeps that out of the render React is already committing.
   */
  const reportFailure = useCallback(() => {
    queueMicrotask(() => setFailed(true));
  }, []);

  // --- map instance ------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    // The worker pool is shared between maps and torn down with the last one.
    // Keeping it warm makes navigating search → property → search cheaper.
    maplibregl.prewarm();

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL / no GPU: the list stays fully usable without the map.
      reportFailure();
      return;
    }

    const markers = markersRef.current;

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      // The canvas is sized at construction time; if the container was still
      // being laid out then, it stays at zero and the map renders nothing.
      map.resize();
      setReady(true);
    });
    map.on("error", (event) => {
      // A failed tile should not blank the map; only a broken style is fatal.
      if (!event?.error) return;
      if (!map.isStyleLoaded()) reportFailure();
    });

    // Only user-driven movement offers "search this area".
    const handleMoveEnd = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) setShowAreaSearch(true);
    };
    map.on("moveend", handleMoveEnd);

    // Keep the canvas in step with the column: the panel can be laid out (or
    // revealed, on mobile) after the map was created.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [reportFailure]);

  // --- markers -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const markers = markersRef.current;
    const nextIds = new Set(results.map((property) => property.id));

    markers.forEach((entry, id) => {
      if (!nextIds.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    });

    for (const property of results) {
      /*
       * Every marker is the Property's own stored point — there is no fallback
       * to a city centre and no offset. A Property without coordinates gets no
       * marker rather than a made-up one: a pin in roughly the right city is
       * worse than no pin, because it looks like an answer (§2).
       */
      if (!Number.isFinite(property.latitude) || !Number.isFinite(property.longitude)) {
        continue;
      }

      const label = formatAmountMinor(property.price.totalAmountMinor);
      const existing = markers.get(property.id);

      if (existing) {
        if (existing.element.textContent !== label) existing.element.textContent = label;
        continue;
      }

      const element = document.createElement("button");
      element.type = "button";
      element.className = "map-marker";
      element.dataset.state = "default";
      element.textContent = label;
      element.setAttribute(
        "aria-label",
        `${property.title}, ${property.district} — ${label} za pobyt`,
      );
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(property.id);
      });
      element.addEventListener("mouseenter", () => onHover(property.id));
      element.addEventListener("mouseleave", () => onHover(null));

      const marker = new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat([property.longitude, property.latitude])
        .addTo(map);

      markers.set(property.id, { marker, element });
    }

    const mappable = results.filter(
      (property) => Number.isFinite(property.latitude) && Number.isFinite(property.longitude),
    );

    if (fitKey !== null && fitKey !== fittedKeyRef.current && mappable.length) {
      fittedKeyRef.current = fitKey;
      fitToResults(map, mappable);
      setShowAreaSearch(false);
    }
  }, [results, ready, onSelect, onHover, fitKey]);

  // --- active states -----------------------------------------------------
  useEffect(() => {
    markersRef.current.forEach(({ element, marker }, id) => {
      const active = id === selectedId || id === hoveredId;
      element.dataset.state = markerState(active, id === bestValueId);
      element.style.zIndex = active ? "3" : id === bestValueId ? "2" : "1";
      marker.getElement().style.zIndex = element.style.zIndex;
    });
  }, [selectedId, hoveredId, results, bestValueId]);

  // --- gentle pan to the selected property -------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;

    const target = resultsRef.current.find((property) => property.id === selectedId);
    if (!target) return;
    if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) return;

    const center: [number, number] = [target.longitude, target.latitude];
    if (map.getBounds().contains(center)) return;

    map.easeTo({
      center,
      duration: prefersReducedMotion() ? 0 : 450,
    });
  }, [selectedId]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center border border-line bg-placeholder p-8">
        <div className="max-w-[280px] text-center">
          <p className="text-[16px] font-bold">Mapa jest chwilowo niedostępna</p>
          <p className="mt-1 text-[14px] text-muted">
            Lista ofert działa normalnie — odśwież stronę, aby spróbować ponownie.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {showAreaSearch ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <button
            type="button"
            onClick={() => {
              const map = mapRef.current;
              if (!map) return;
              const bounds = map.getBounds();
              setShowAreaSearch(false);
              onSearchArea({
                west: bounds.getWest(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                north: bounds.getNorth(),
              });
            }}
            className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-brand bg-surface px-5 text-[14px] font-bold text-brand shadow-[0_4px_14px_-6px_rgba(16,24,20,0.4)] transition-colors hover:bg-brand hover:text-surface"
          >
            <Search size={15} strokeWidth={2.6} />
            Szukaj w tym obszarze
          </button>
        </div>
      ) : null}
    </div>
  );
}

function fitToResults(map: MapLibreMap, results: PropertySummary[]) {
  const { width, height } = map.getCanvas().getBoundingClientRect();

  // fitBounds with padding wider than the viewport yields a broken camera and
  // the map renders nothing at all — bail out to a plain center instead.
  if (width < 200 || height < 200) {
    map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    return;
  }

  if (results.length === 1) {
    const [property] = results;
    map.jumpTo({ center: [property.longitude, property.latitude], zoom: 13.5 });
    return;
  }

  const bounds = results.reduce(
    (acc, property) => acc.extend([property.longitude, property.latitude]),
    new maplibregl.LngLatBounds(
      [results[0].longitude, results[0].latitude],
      [results[0].longitude, results[0].latitude],
    ),
  );

  map.fitBounds(bounds as LngLatBoundsLike, {
    padding: {
      top: Math.min(70, height / 5),
      bottom: Math.min(70, height / 5),
      left: Math.min(60, width / 5),
      right: Math.min(60, width / 5),
    },
    maxZoom: 14,
    duration: 0,
  });

  // Last line of defence: never leave the camera in an unrenderable state.
  if (!Number.isFinite(map.getZoom())) {
    map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  }
}
