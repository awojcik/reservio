import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  VARIANTS,
  generateVariants,
  variantKey,
  variantKeys,
} from "../src/modules/properties/images/image-variants";

function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 70, g: 140, b: 110 } },
  }).jpeg();
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
}

const WEBP = (body: Buffer) =>
  body.subarray(0, 4).toString("ascii") === "RIFF" &&
  body.subarray(8, 12).toString("ascii") === "WEBP";

describe("variant keys", () => {
  it("sit next to the original, under a versioned path", () => {
    expect(variantKey("properties/p1/abc.jpg", 1, "card")).toBe("properties/p1/abc/v1/card.webp");
    expect(variantKey("properties/p1/abc.webp", 2, "hero")).toBe("properties/p1/abc/v2/hero.webp");
  });

  it("name one key per variant", () => {
    expect(variantKeys("properties/p1/abc.png", 1)).toEqual([
      "properties/p1/abc/v1/thumb.webp",
      "properties/p1/abc/v1/card.webp",
      "properties/p1/abc/v1/detail.webp",
      "properties/p1/abc/v1/hero.webp",
    ]);
  });
});

describe("generateVariants", () => {
  it("makes every variant at its width, as WebP, keeping the aspect ratio", async () => {
    const result = await generateVariants(await jpeg(3000, 2000));

    expect(result).toMatchObject({ width: 3000, height: 2000 });
    expect(result.variants.map((variant) => [variant.name, variant.width, variant.height])).toEqual([
      ["thumb", 240, 160],
      ["card", 640, 427],
      ["detail", 1200, 800],
      ["hero", 1600, 1067],
    ]);
    for (const variant of result.variants) {
      expect(WEBP(variant.body)).toBe(true);
      expect((await sharp(variant.body).metadata()).width).toBe(variant.width);
    }
  });

  it("never upscales a photo smaller than a variant", async () => {
    const result = await generateVariants(await jpeg(800, 600));

    expect(result.variants.map((variant) => variant.width)).toEqual([240, 640, 800, 800]);
  });

  it("applies the EXIF orientation, then drops the metadata", async () => {
    // Stored landscape, tagged "rotate 90° clockwise" — what a phone portrait looks like.
    const result = await generateVariants(await jpeg(1600, 1200, 6));

    expect(result).toMatchObject({ width: 1200, height: 1600 });
    const hero = result.variants.find((variant) => variant.name === "hero")!;
    expect([hero.width, hero.height]).toEqual([1200, 1600]);

    const metadata = await sharp(hero.body).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("refuses bytes that are not an image", async () => {
    await expect(
      generateVariants(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)])),
    ).rejects.toThrow();
  });

  it("covers the widths the web loader picks from", () => {
    expect(VARIANTS.map((variant) => variant.width)).toEqual([240, 640, 1200, 1600]);
  });
});
