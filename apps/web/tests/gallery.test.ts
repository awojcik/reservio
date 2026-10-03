import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INITIAL_FRAME,
  activeImage,
  clampFrame,
  galleryFrames,
  stepFrame,
  thumbnailState,
} from "../lib/gallery";

const PHOTOS = [
  "https://cdn.test/cover.jpg",
  "https://cdn.test/kitchen.jpg",
  "https://cdn.test/bedroom.jpg",
  "https://cdn.test/view.jpg",
];

describe("initial image", () => {
  it("opens on the cover, not on whatever sorted first", () => {
    const frames = galleryFrames(PHOTOS);

    expect(INITIAL_FRAME).toBe(0);
    expect(activeImage(frames, INITIAL_FRAME)).toBe("https://cdn.test/cover.jpg");
  });

  it("keeps the Host's order and drops blanks and repeats", () => {
    // Two identical thumbnails would fight over the active state, and an empty
    // src renders as a broken frame.
    const frames = galleryFrames([
      "https://cdn.test/cover.jpg",
      "  ",
      "https://cdn.test/kitchen.jpg",
      "https://cdn.test/cover.jpg",
    ]);

    expect(frames).toEqual([
      "https://cdn.test/cover.jpg",
      "https://cdn.test/kitchen.jpg",
    ]);
  });

  it("has nothing to show for a Property with no photos", () => {
    expect(galleryFrames([])).toEqual([]);
    expect(activeImage([], INITIAL_FRAME)).toBeUndefined();
  });
});

describe("thumbnail click", () => {
  it("moves the main image to the thumbnail that was clicked", () => {
    const frames = galleryFrames(PHOTOS);

    expect(activeImage(frames, clampFrame(2, frames.length))).toBe(
      "https://cdn.test/bedroom.jpg",
    );
    expect(activeImage(frames, clampFrame(3, frames.length))).toBe(
      "https://cdn.test/view.jpg",
    );
  });

  it("survives a selection that no longer exists", () => {
    // A Host removing a photo while the page is open must not blank the frame.
    const frames = galleryFrames(PHOTOS).slice(0, 2);

    expect(clampFrame(3, frames.length)).toBe(1);
    expect(clampFrame(-1, frames.length)).toBe(INITIAL_FRAME);
    expect(clampFrame(Number.NaN, frames.length)).toBe(INITIAL_FRAME);
  });

  it("steps in step with the thumbnails, wrapping at both ends", () => {
    const total = PHOTOS.length;

    expect(stepFrame(0, 1, total)).toBe(1);
    expect(stepFrame(3, 1, total)).toBe(0);
    expect(stepFrame(0, -1, total)).toBe(3);
  });
});

describe("active thumbnail", () => {
  it("marks exactly the selected one", () => {
    const states = PHOTOS.map((_, index) => thumbnailState(index, 2));

    expect(states).toEqual(["default", "default", "active", "default"]);
    expect(states.filter((state) => state === "active")).toHaveLength(1);
  });

  it("marks the cover before anything is clicked", () => {
    expect(thumbnailState(0, INITIAL_FRAME)).toBe("active");
  });
});

/**
 * The rules above are only worth anything if the component actually uses them.
 * Rendering needs a DOM these tests do not have, so this checks the wiring at
 * the source level: the click handler, the active marker, and that the frame
 * swap happens in the browser rather than via a navigation.
 */
describe("the gallery component is wired to them", () => {
  const source = readFileSync(
    join(__dirname, "..", "components/property/Gallery.tsx"),
    "utf8",
  );

  it("swaps the frame in the browser", () => {
    expect(source).toContain('"use client"');
    expect(source).toMatch(/useState/);
    // A link or a form would take the whole page with it.
    expect(source).not.toMatch(/<Link|<form|router\.(push|replace)/);
  });

  it("selects on click and marks the active thumbnail", () => {
    expect(source).toMatch(/onClick=\{\(\) => show\(index\)\}/);
    expect(source).toMatch(/thumbnailState\(index, active\)/);
    expect(source).toMatch(/aria-pressed=\{index === active\}/);
  });
});
