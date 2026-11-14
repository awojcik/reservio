import type { ObjectStorage } from "../../storage/object-storage";
import { VARIANTS, variantKey, type VariantName } from "./image-variants";

export type ImageVariantUrls = Record<VariantName, string>;

export type ImageSources = {
  /** The original, or the seeded catalogue's remote URL. Always present. */
  url: string;
  /**
   * Ready-made WebP files on the CDN, or `null` while there are none — the
   * client then shows `url` exactly as before.
   */
  variants: ImageVariantUrls | null;
};

/**
 * Every place that turns a PropertyImage row into something a browser can
 * load goes through here, so the Listing card, the Listing page and the Host
 * editor cannot disagree about which file a photo is.
 */
export function imageSources(
  storage: ObjectStorage,
  image: { objectKey: string | null; url: string | null; variantsVersion: number | null },
): ImageSources {
  if (!image.objectKey) return { url: image.url ?? "", variants: null };

  const { objectKey, variantsVersion } = image;
  return {
    url: storage.getPublicUrl(objectKey),
    variants: variantsVersion
      ? (Object.fromEntries(
          VARIANTS.map((variant) => [
            variant.name,
            storage.getPublicUrl(variantKey(objectKey, variantsVersion, variant.name)),
          ]),
        ) as ImageVariantUrls)
      : null,
  };
}
