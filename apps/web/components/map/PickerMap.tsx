"use client";

import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "./mapStyle";

type PickerMapProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
};

/**
 * The same MapLibre stack the guest-facing maps use — no second mapping
 * dependency just for this form.
 *
 * The point normally arrives from geocoding the address the Host typed; the
 * map's job is to show where that landed and let them correct it. A dragged
 * marker is stored exactly like a geocoded one — the Host is closer to the
 * building than any geocoder (§1).
 */
export default function PickerMap({ latitude, longitude, onChange }: PickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [failed, setFailed] = useState(false);

  // Kept in a ref so a new callback identity never rebuilds the map.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    maplibregl.prewarm();

    const hasPoint = latitude !== null && longitude !== null;
    const center: [number, number] = hasPoint
      ? [longitude, latitude]
      : DEFAULT_CENTER;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center,
        zoom: hasPoint ? 14 : DEFAULT_ZOOM,
        attributionControl: { compact: true },
      });
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => map.resize());
    map.on("error", () => {
      if (!map.isStyleLoaded()) setFailed(true);
    });

    const element = document.createElement("div");
    element.className =
      "size-5 cursor-grab rounded-full border-2 border-surface bg-accent shadow-[0_1px_5px_rgba(16,24,20,0.4)]";
    element.setAttribute("aria-label", "Lokalizacja obiektu — przeciągnij, aby poprawić");
    element.title = "Przeciągnij, aby poprawić lokalizację";

    const marker = new maplibregl.Marker({ element, draggable: true }).setLngLat(center);
    markerRef.current = marker;
    if (hasPoint) marker.addTo(map);

    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      onChangeRef.current(round(lat), round(lng));
    });

    map.on("click", (event) => {
      marker.setLngLat(event.lngLat).addTo(map);
      onChangeRef.current(round(event.lngLat.lat), round(event.lngLat.lng));
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Built once; later coordinate changes are pushed through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typing coordinates by hand should move the marker too.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || latitude === null || longitude === null) return;

    const current = marker.getLngLat();
    if (Math.abs(current.lat - latitude) < 1e-6 && Math.abs(current.lng - longitude) < 1e-6) {
      return;
    }

    marker.setLngLat([longitude, latitude]).addTo(map);
    map.easeTo({ center: [longitude, latitude], duration: 300 });
  }, [latitude, longitude]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center bg-placeholder px-4 text-center text-[14px] font-semibold text-muted">
        Mapa jest niedostępna — wpisz współrzędne ręcznie
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}

/** Six decimals is roughly 10 cm — far beyond what a Listing needs. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
