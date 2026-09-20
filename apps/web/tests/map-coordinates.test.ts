import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * Every marker Rezervio draws comes from `Property.latitude` /
 * `Property.longitude` — the numbers a Host confirmed in the editor.
 *
 * These are source-level checks rather than rendered-map assertions on purpose:
 * MapLibre needs WebGL and will not run here, and the thing worth protecting is
 * not how a marker looks but *where its coordinates came from*. A city-centre
 * fallback or a random offset creeping back in is exactly what this catches
 * (§2, §3).
 */
const MAP_SOURCES = [
  "components/map/PropertyMap.tsx",
  "components/map/MiniMap.tsx",
  "components/map/PickerMap.tsx",
  "components/property/PropertyLocation.tsx",
  "components/property/PropertyDetailView.tsx",
];

describe("no invented coordinates", () => {
  it("never randomises or offsets a position", () => {
    for (const path of MAP_SOURCES) {
      const code = source(path);

      expect(code, path).not.toMatch(/Math\.random/);
      // A "jitter", "scatter" or "offset" applied to a coordinate is the
      // classic way a demo map ends up lying about where things are.
      expect(code, path).not.toMatch(/jitter|scatter|randomOffset/i);
    }
  });

  /**
   * `DEFAULT_CENTER` exists, and legitimately: an empty map has to point
   * somewhere before any result arrives. What it must never do is stand in for
   * a Property that has no coordinates.
   */
  it("uses the shared default centre only as an empty-map camera", () => {
    const code = source("components/map/PropertyMap.tsx");

    for (const match of code.matchAll(/DEFAULT_CENTER/g)) {
      const line = code.slice(0, match.index).split("\n").length;
      const context = code.split("\n")[line - 1];

      // Either part of the import list, or a camera call — never a marker.
      const isImportLine = /^\s*DEFAULT_CENTER,?$/.test(context);
      const isCamera = /center:|jumpTo/.test(context);

      expect(isImportLine || isCamera, `line ${line}: ${context.trim()}`).toBe(true);
      expect(context).not.toMatch(/setLngLat|Marker/);
    }
  });

  it("positions every marker from the Property's own fields", () => {
    const code = source("components/map/PropertyMap.tsx");

    // The only `setLngLat` in the results map is the Property's own point.
    const positions = [...code.matchAll(/setLngLat\(([^)]*)\)/g)].map((m) => m[1]);
    expect(positions.length).toBeGreaterThan(0);

    for (const position of positions) {
      expect(position).toContain("property.longitude");
      expect(position).toContain("property.latitude");
    }
  });

  it("skips a Property with no usable point instead of inventing one", () => {
    const code = source("components/map/PropertyMap.tsx");

    expect(code).toMatch(/Number\.isFinite\(property\.latitude\)/);
    expect(code).toMatch(/continue;/);
  });

  it("fits the viewport to the results, not to a fixed city", () => {
    const code = source("components/map/PropertyMap.tsx");

    expect(code).toMatch(/fitBounds/);
    expect(code).toMatch(/results\.reduce/);
    expect(code).toMatch(/extend\(\[property\.longitude, property\.latitude\]\)/);
  });

  it("draws the detail map from the Property's stored point", () => {
    const detail = source("components/property/PropertyDetailView.tsx");

    expect(detail).toMatch(/latitude=\{property\.latitude\}/);
    expect(detail).toMatch(/longitude=\{property\.longitude\}/);
    // And refuses to draw one when there is nothing real to draw.
    expect(detail).toMatch(/hasLocation/);

    const mini = source("components/map/MiniMap.tsx");
    expect(mini).toMatch(/setLngLat\(\[longitude, latitude\]\)/);
  });
});

/**
 * The basemap is a look, not an architecture. Changing it must stay a one-line
 * change to a shared constant, pointing at a ready-made OpenFreeMap style —
 * not a hand-rolled style object, and not a second provider creeping in behind
 * one of the maps.
 */
describe("basemap", () => {
  it("is one OpenFreeMap style, shared by every map", () => {
    const style = source("components/map/mapStyle.ts");

    expect(style).toMatch(
      /MAP_STYLE_URL = "https:\/\/tiles\.openfreemap\.org\/styles\/[a-z0-9-]+"/,
    );

    for (const path of [
      "components/map/PropertyMap.tsx",
      "components/map/MiniMap.tsx",
      "components/map/PickerMap.tsx",
    ]) {
      const code = source(path);

      expect(code, path).toMatch(/style: MAP_STYLE_URL/);
      // No second tile host, and no style built inline.
      expect(code, path).not.toMatch(/mapbox|maptiler|\bstyle: \{/i);
    }
  });
});

/**
 * A marker and a card are the same Property or the feature is broken. Both are
 * keyed by `property.id`, which is what makes hover, selection and the scroll
 * target line up (§2).
 */
describe("card ↔ marker identity", () => {
  it("keys markers and cards by the same Property id", () => {
    const map = source("components/map/PropertyMap.tsx");
    const shell = source("components/search/SearchExperience.tsx");

    expect(map).toMatch(/markers\.set\(property\.id/);
    expect(map).toMatch(/onSelect\(property\.id\)/);
    expect(map).toMatch(/onHover\(property\.id\)/);

    expect(shell).toMatch(/cardRefs\.current\.set\(property\.id/);
    expect(shell).toMatch(/selectedId === property\.id/);
    expect(shell).toMatch(/hoveredId === property\.id/);
  });

  it("drops a selection whose Property left the result set", () => {
    const shell = source("components/search/SearchExperience.tsx");
    expect(shell).toMatch(/results\.some\(\(property\) => property\.id === pickedId\)/);
  });
});

/**
 * The Host editor writes coordinates in exactly one place, so a dragged marker
 * and a geocoded point are stored the same way (§1).
 */
describe("host location picker", () => {
  it("has a draggable marker that reports where it was dropped", () => {
    const picker = source("components/map/PickerMap.tsx");

    expect(picker).toMatch(/draggable: true/);
    expect(picker).toMatch(/marker\.on\("dragend"/);
    expect(picker).toMatch(/onChangeRef\.current\(round\(lat\), round\(lng\)\)/);
  });

  it("routes both the geocoder and the marker through one setter", () => {
    const editor = source("components/host/PropertyEditor.tsx");

    expect(editor).toMatch(/const setCoordinates = useCallback/);
    expect(editor).toMatch(/onChange=\{setCoordinates\}/);
    expect(editor).toMatch(/onResolved: setCoordinates/);
  });
});
