import { getImageProps } from "next/image";
import { describe, expect, it } from "vitest";

import { galleryFrames } from "@/lib/gallery";
import { VARIANT_WIDTHS, variantFor, variantLoader } from "@/lib/image-variants";

const CDN = "https://bucket.fra1.cdn.digitaloceanspaces.com/properties/p/abc";
const ORIGINAL = `${CDN}.jpg`;
const VARIANTS = {
  thumb: `${CDN}/v1/thumb.webp`,
  card: `${CDN}/v1/card.webp`,
  detail: `${CDN}/v1/detail.webp`,
  hero: `${CDN}/v1/hero.webp`,
};

describe("picking a variant", () => {
  it("takes the smallest file wide enough for the request", () => {
    expect(variantFor(VARIANTS, 140)).toBe(VARIANTS.thumb);
    expect(variantFor(VARIANTS, 464)).toBe(VARIANTS.card);
    expect(variantFor(VARIANTS, 1170)).toBe(VARIANTS.detail);
    expect(variantFor(VARIANTS, 1600)).toBe(VARIANTS.hero);
  });

  /** Next asks from its own width ladder; 256 must not skip a 240 px file. */
  it("accepts a file up to a tenth narrower than asked", () => {
    expect(variantFor(VARIANTS, 256)).toBe(VARIANTS.thumb);
    expect(variantFor(VARIANTS, 384)).toBe(VARIANTS.card);
    expect(variantFor(VARIANTS, 750)).toBe(VARIANTS.detail);
  });

  it("serves the largest beyond the largest", () => {
    expect(variantFor(VARIANTS, 3840)).toBe(VARIANTS.hero);
  });

  it("knows the API's widths", () => {
    expect(VARIANT_WIDTHS.map(([, width]) => width)).toEqual([240, 640, 1200, 1600]);
  });
});

/**
 * What the browser is actually handed. `getImageProps` is the same code path
 * `<Image>` renders through, so this is the `src`/`srcset` of the real
 * element, not a re-implementation of it.
 */
describe("what next/image renders for a photo with variants", () => {
  function rendered(sizes: string, variants?: typeof VARIANTS) {
    return getImageProps({
      src: ORIGINAL,
      alt: "",
      fill: true,
      sizes,
      loader: variants ? variantLoader(variants) : undefined,
    }).props;
  }

  it("points every candidate at the CDN, never at /_next/image", () => {
    const { src, srcSet } = rendered("(max-width: 640px) 100vw, 232px", VARIANTS);

    expect(src).not.toContain("/_next/image");
    expect(srcSet).not.toContain("/_next/image");
    for (const candidate of srcSet!.split(", ")) {
      expect(Object.values(VARIANTS)).toContain(candidate.split(" ")[0]);
    }
  });

  /**
   * The browser's own rule: the smallest candidate whose declared width
   * covers the slot's CSS width times the device pixel ratio.
   */
  function chosen(srcSet: string, devicePixels: number): string {
    const candidates = srcSet
      .split(", ")
      .map((entry) => entry.split(" "))
      .map(([url, width]) => ({ url, width: Number.parseInt(width, 10) }));
    return (candidates.find((candidate) => candidate.width >= devicePixels) ?? candidates.at(-1)!)
      .url;
  }

  /**
   * With a `vw` in `sizes` Next offers nothing below its smallest device size
   * (640), so a card gets the card file on every screen — never the original.
   */
  it("serves a listing card at 232 px the card file", () => {
    const { srcSet } = rendered("(max-width: 640px) 100vw, 232px", VARIANTS);

    expect(chosen(srcSet!, 232)).toBe(VARIANTS.card);
    expect(chosen(srcSet!, 464)).toBe(VARIANTS.card);
  });

  it("serves a fixed 140 px thumbnail the thumb file", () => {
    expect(chosen(rendered("140px", VARIANTS).srcSet!, 140)).toBe(VARIANTS.thumb);
  });

  it("serves a phone-wide card on a 3× screen the detail file", () => {
    expect(chosen(rendered("100vw", VARIANTS).srcSet!, 390 * 3)).toBe(VARIANTS.detail);
  });

  it("serves the gallery's main frame on a large retina screen the hero file", () => {
    const { srcSet } = rendered("(max-width: 640px) 100vw, 60vw", VARIANTS);

    expect(chosen(srcSet!, 0.6 * 1440 * 2)).toBe(VARIANTS.hero);
  });

  it("serves a gallery thumbnail a small file", () => {
    const { srcSet } = rendered("(max-width: 640px) 50vw, 20vw", VARIANTS);

    expect(chosen(srcSet!, 0.2 * 1280)).toBe(VARIANTS.thumb);
  });

  /** A photo without variants yet, or one from the seeded catalogue. */
  it("falls back to the optimiser, exactly as before, without variants", () => {
    const { src } = rendered("232px");

    expect(src).toContain("/_next/image?url=");
    expect(src).toContain(encodeURIComponent(ORIGINAL));
  });
});

describe("gallery frames with variants", () => {
  it("drop blanks and repeats by URL, and keep the variants", () => {
    const frames = galleryFrames([
      { url: ORIGINAL, variants: VARIANTS },
      { url: " ", variants: null },
      { url: ORIGINAL, variants: null },
    ]);

    expect(frames).toEqual([{ url: ORIGINAL, variants: VARIANTS }]);
  });
});
