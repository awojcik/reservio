/**
 * OpenFreeMap Liberty.
 *
 * Positron, which this used to be, is a greyscale basemap: water, parks and
 * built-up land all arrive as the same wash of grey, so a map of a seaside
 * city reads as a street diagram rather than a place. Liberty is the same
 * OpenMapTiles schema from the same host — so coordinates, zoom levels, glyphs
 * and attribution are unchanged — but it colours what the Guest is actually
 * choosing between: water in a light blue, parks and green space in a soft
 * green, built-up land in a warm off-white, roads present but quiet.
 *
 * A ready-made style rather than a hand-rolled one on purpose: 111 layers
 * maintained upstream is not something worth re-deriving, and a custom style
 * would silently rot against schema changes.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Gdańsk, Długie Pobrzeże. */
export const DEFAULT_CENTER: [number, number] = [18.6135, 54.3925];
export const DEFAULT_ZOOM = 11.2;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
