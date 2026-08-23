"use client";

import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { MAP_STYLE_URL } from "./mapStyle";

type MiniMapProps = {
  latitude: number;
  longitude: number;
  label: string;
};

export default function MiniMap({ latitude, longitude, label }: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    maplibregl.prewarm();

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [longitude, latitude],
        zoom: 13.4,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL: fall back to the text panel, the page stays usable.
      queueMicrotask(() => setFailed(true));
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => map.resize());
    map.on("error", () => {
      if (!map.isStyleLoaded()) setFailed(true);
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    const element = document.createElement("div");
    element.className =
      "size-4 rounded-full border-2 border-white bg-[#FF5B45] shadow-[0_1px_4px_rgba(24,34,29,0.35)]";
    element.setAttribute("aria-label", label);

    new maplibregl.Marker({ element }).setLngLat([longitude, latitude]).addTo(map);

    return () => {
      observer.disconnect();
      map.remove();
    };
  }, [latitude, longitude, label]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center bg-[#EDE7DA] text-[14px] font-semibold text-muted">
        Mapa jest chwilowo niedostępna
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
