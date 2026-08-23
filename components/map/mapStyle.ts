/** OpenFreeMap Positron — the calmest light basemap available for dev use. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Gdańsk, Długie Pobrzeże. */
export const DEFAULT_CENTER: [number, number] = [18.6135, 54.3925];
export const DEFAULT_ZOOM = 11.2;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
