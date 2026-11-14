import type { ImageLoader } from "next/image";

import type { ImageVariants } from "@rezervio/api-client";

/**
 * Listing photos as ready-made files on the CDN.
 *
 * The API generates four WebP widths when a photo is uploaded. Handing them to
 * `next/image` through a loader keeps everything the component does well —
 * `srcset` from `sizes`, lazy loading, the preloaded cover, the failure
 * fallback — while every URL it emits points at the CDN instead of at
 * `/_next/image`, so no photo is resized on the droplet at request time.
 *
 * Widths are the API's maxima (`VARIANTS` in the api's image-variants.ts).
 * A photo smaller than a variant was not upscaled, so its file may be
 * narrower than the name says — which only ever means fewer bytes.
 */
export const VARIANT_WIDTHS = [
  ["thumb", 240],
  ["card", 640],
  ["detail", 1200],
  ["hero", 1600],
] as const satisfies readonly (readonly [keyof ImageVariants, number])[];

/**
 * How much narrower than asked a variant may be and still be chosen.
 *
 * Next asks for widths from its own ladder (…128, 256, 384, 640, 750…), not
 * from ours. Without slack a 256 px request skips the 240 px thumb for the
 * 640 px card — two and a half times the pixels for a difference no one can
 * see. Ten percent keeps every choice visually indistinguishable.
 */
const TOLERANCE = 0.9;

/** The smallest variant wide enough for `width`; the largest beyond that. */
export function variantFor(variants: ImageVariants, width: number): string {
  for (const [name, variantWidth] of VARIANT_WIDTHS) {
    if (variantWidth >= width * TOLERANCE) return variants[name];
  }
  return variants.hero;
}

/**
 * A loader bound to one photo's variants. `src` is ignored on purpose: the
 * component is given the original as `src`, which is also what Next's
 * development check compares against to confirm the loader honours width.
 */
export function variantLoader(variants: ImageVariants): ImageLoader {
  return ({ width }) => variantFor(variants, width);
}
