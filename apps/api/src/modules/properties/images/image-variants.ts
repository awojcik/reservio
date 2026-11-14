import sharp from "sharp";

/**
 * Photo variants, made once when a photo is uploaded instead of on every
 * request.
 *
 * Until now every Listing photo was resized by the Next.js optimiser at
 * request time, on a droplet with one vCPU that also runs the API, the worker,
 * PostgreSQL and Redis. nginx caches the result, but its key is photo × width
 * × quality × format, so every new photo, every new screen width and every
 * cache eviction paid for a full decode of an original of up to 5 MB.
 *
 * These four widths cover every place a Listing photo is shown; the browser
 * picks among them through `srcset` and fetches the file straight from the
 * CDN.
 */

export const VARIANTS = [
  { name: "thumb", width: 240, quality: 75 },
  { name: "card", width: 640, quality: 75 },
  { name: "detail", width: 1200, quality: 80 },
  { name: "hero", width: 1600, quality: 80 },
] as const;

export type VariantName = (typeof VARIANTS)[number]["name"];

/**
 * Bumped whenever the set above changes — sizes, quality or format.
 *
 * The version is part of every variant key, so a new set is written under new
 * URLs and never over files that browsers and the CDN were told to keep for a
 * year. Rows still on an older version are picked up by the backfill.
 */
export const VARIANTS_VERSION = 1;

/**
 * The URL never changes content: a replaced photo is a new upload with a new
 * key, and a new variant set is a new version in the path.
 */
export const VARIANT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * 40 megapixels: comfortably above any phone or camera photo a Host would
 * upload, and a hard stop for a small file that decodes into gigabytes.
 * libvips allocates outside the V8 heap, so `WORKER_HEAP_MB` does not cap it.
 */
const MAX_INPUT_PIXELS = 40_000_000;

// One photo at a time, without libvips' operation cache: the worker shares one
// vCPU and two gigabytes with everything else on the droplet.
sharp.concurrency(1);
sharp.cache(false);

/**
 * `properties/{propertyId}/{uuid}.jpg` → `properties/{propertyId}/{uuid}/v1/card.webp`.
 *
 * Next to the original, under the same server-minted identity, so a variant
 * can only ever belong to the photo it was made from.
 */
export function variantKey(objectKey: string, version: number, name: VariantName): string {
  const stem = objectKey.replace(/\.[^./]+$/, "");
  return `${stem}/v${version}/${name}.webp`;
}

export function variantKeys(objectKey: string, version: number): string[] {
  return VARIANTS.map((variant) => variantKey(objectKey, version, variant.name));
}

export type GeneratedVariant = {
  name: VariantName;
  width: number;
  height: number;
  body: Buffer;
};

export type GeneratedVariants = {
  /** The original's dimensions, after EXIF orientation. */
  width: number;
  height: number;
  variants: GeneratedVariant[];
};

/**
 * Reads the dimensions from the header, then decodes the original once per
 * variant and encodes WebP.
 *
 * - `autoOrient` applies the EXIF orientation. It has to happen before the
 *   metadata is dropped, or a portrait taken on a phone comes out lying on
 *   its side.
 * - `withoutEnlargement` keeps a small photo at its own size: upscaling adds
 *   bytes and no detail.
 * - Metadata, EXIF location included, is stripped — sharp keeps none unless
 *   asked to.
 *
 * A file that does not decode throws, which is the last line of defence
 * behind the magic-byte check at confirm time. `failOn` stays at sharp's
 * default, the strictest level it recommends for untrusted input.
 */
export async function generateVariants(original: Buffer): Promise<GeneratedVariants> {
  const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true } as const;

  const metadata = await sharp(original, options).metadata();

  const variants: GeneratedVariant[] = [];
  for (const variant of VARIANTS) {
    const { data, info } = await sharp(original, options)
      .resize({ width: variant.width, withoutEnlargement: true })
      .webp({ quality: variant.quality })
      .toBuffer({ resolveWithObject: true });

    variants.push({ name: variant.name, width: info.width, height: info.height, body: data });
  }

  return {
    width: metadata.autoOrient.width,
    height: metadata.autoOrient.height,
    variants,
  };
}
