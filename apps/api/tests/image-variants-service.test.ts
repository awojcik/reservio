import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { imageSources } from "../src/modules/properties/images/image-sources";
import {
  VARIANTS_VERSION,
  VARIANT_CACHE_CONTROL,
} from "../src/modules/properties/images/image-variants";
import { ImageVariantsService } from "../src/modules/properties/images/image-variants.service";
import {
  requestVariants,
  variantsJobId,
} from "../src/modules/properties/images/pending-variants";
import type { ObjectStorage, ServerUpload } from "../src/modules/storage/object-storage";

/**
 * The variant job's wiring: what it reads, what it writes, and what it does on
 * a second run. Storage and the database are stubbed — CI has no bucket, and
 * the point here is the order of operations, not S3.
 */

const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const PROPERTY_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_KEY = `properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222.jpg`;

type Row = { id: string; propertyId: string; objectKey: string | null; variantsVersion: number | null };

function photo(): Promise<Buffer> {
  return sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#3a6" } })
    .jpeg()
    .toBuffer();
}

function harness(row: Row | null, original: Buffer | null, options: { deletedMeanwhile?: boolean } = {}) {
  const puts: ServerUpload[] = [];
  const updates: unknown[] = [];

  const storage = {
    getObject: vi.fn(async () => original),
    putObject: vi.fn(async (upload: ServerUpload) => {
      puts.push(upload);
    }),
    deleteObject: vi.fn(async () => undefined),
    getPublicUrl: (key: string) => `https://cdn.example/${key}`,
  } as unknown as ObjectStorage & {
    getObject: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };

  const select = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(row ? [row] : []);
    return chain;
  };

  const database = {
    db: {
      select,
      update: () => ({
        set: (values: unknown) => ({
          where: () => ({
            returning: async () => {
              updates.push(values);
              return options.deletedMeanwhile ? [] : [{ id: IMAGE_ID }];
            },
          }),
        }),
      }),
    },
  } as unknown as Database;

  const service = new ImageVariantsService(database, storage, {} as never);
  return { service, storage, puts, updates };
}

const ROW: Row = { id: IMAGE_ID, propertyId: PROPERTY_ID, objectKey: OBJECT_KEY, variantsVersion: null };

describe("generating a photo's variants", () => {
  it("writes four public, immutable WebP files and records the version", async () => {
    const { service, puts, updates } = harness(ROW, await photo());

    await expect(service.generate(IMAGE_ID)).resolves.toEqual({ status: "generated", variants: 4 });

    expect(puts.map((put) => put.objectKey)).toEqual([
      `properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222/v${VARIANTS_VERSION}/thumb.webp`,
      `properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222/v${VARIANTS_VERSION}/card.webp`,
      `properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222/v${VARIANTS_VERSION}/detail.webp`,
      `properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222/v${VARIANTS_VERSION}/hero.webp`,
    ]);
    for (const put of puts) {
      expect(put.contentType).toBe("image/webp");
      expect(put.cacheControl).toBe(VARIANT_CACHE_CONTROL);
      expect(put.cacheControl).toContain("immutable");
    }
    expect(updates).toEqual([{ variantsVersion: VARIANTS_VERSION, width: 2000, height: 1500 }]);
  });

  /** What a retry after success sees: the row already says the work is done. */
  it("does nothing for a photo already on the current version", async () => {
    const { service, storage, puts, updates } = harness(
      { ...ROW, variantsVersion: VARIANTS_VERSION },
      await photo(),
    );

    await expect(service.generate(IMAGE_ID)).resolves.toEqual({ status: "skipped", reason: "current" });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  /** What a retry after a crash halfway sees: the same keys, written again. */
  it("writes the same keys when run twice before recording", async () => {
    const original = await photo();
    const first = harness(ROW, original);
    const second = harness(ROW, original);

    await first.service.generate(IMAGE_ID);
    await second.service.generate(IMAGE_ID);

    expect(second.puts.map((put) => put.objectKey)).toEqual(first.puts.map((put) => put.objectKey));
  });

  it("does nothing for a photo deleted before the job ran", async () => {
    const { service, storage } = harness(null, await photo());

    await expect(service.generate(IMAGE_ID)).resolves.toEqual({ status: "skipped", reason: "missing" });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("does nothing for the seeded catalogue, which has no stored original", async () => {
    const { service } = harness({ ...ROW, objectKey: null }, null);

    await expect(service.generate(IMAGE_ID)).resolves.toEqual({
      status: "skipped",
      reason: "not_stored",
    });
  });

  it("removes what it wrote when the photo was deleted while it worked", async () => {
    const { service, storage } = harness(ROW, await photo(), { deletedMeanwhile: true });

    await expect(service.generate(IMAGE_ID)).resolves.toEqual({
      status: "abandoned",
      reason: "deleted_meanwhile",
    });
    expect(storage.deleteObject).toHaveBeenCalledTimes(4);
  });

  it("gives up without retrying when the original is gone", async () => {
    const { service, puts } = harness(ROW, null);

    await expect(service.generate(IMAGE_ID)).resolves.toEqual({
      status: "abandoned",
      reason: "original_missing",
    });
    expect(puts).toHaveLength(0);
  });

  /** Throwing is what lets BullMQ retry and record the failure. */
  it("fails, and records nothing, when the original does not decode", async () => {
    const { service, updates } = harness(ROW, Buffer.from("definitely not a photo"));

    await expect(service.generate(IMAGE_ID)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it("removes every variant of a deleted photo, and survives a failing delete", async () => {
    const { service, storage } = harness(ROW, null);
    storage.deleteObject.mockRejectedValueOnce(new Error("AccessDenied"));

    await service.removeVariants(OBJECT_KEY, PROPERTY_ID);

    expect(storage.deleteObject).toHaveBeenCalledTimes(4 * VARIANTS_VERSION);
  });
});

describe("requesting variants", () => {
  function queue(existing: { failed: boolean } | null) {
    const job = existing
      ? { isFailed: vi.fn(async () => existing.failed), retry: vi.fn(async () => undefined) }
      : null;
    return {
      job,
      queue: {
        getJob: vi.fn(async () => job),
        add: vi.fn(async () => undefined),
      } as never as Parameters<typeof requestVariants>[0] & { add: ReturnType<typeof vi.fn> },
    };
  }

  it("queues one job per photo and version", async () => {
    const { queue: q } = queue(null);

    await expect(requestVariants(q, IMAGE_ID)).resolves.toBe("queued");
    expect(q.add).toHaveBeenCalledWith("generate", { imageId: IMAGE_ID }, {
      jobId: variantsJobId(IMAGE_ID),
    });
    expect(variantsJobId(IMAGE_ID)).toBe(`variants:${IMAGE_ID}:v${VARIANTS_VERSION}`);
  });

  it("leaves a job that is waiting, running or done alone", async () => {
    const { queue: q } = queue({ failed: false });

    await expect(requestVariants(q, IMAGE_ID)).resolves.toBe("exists");
    expect(q.add).not.toHaveBeenCalled();
  });

  it("retries a job that failed for good", async () => {
    const { queue: q, job } = queue({ failed: true });

    await expect(requestVariants(q, IMAGE_ID)).resolves.toBe("retried");
    expect(job!.retry).toHaveBeenCalled();
  });
});

describe("image sources", () => {
  const storage = { getPublicUrl: (key: string) => `https://cdn.example/${key}` } as ObjectStorage;

  it("offers only the original until variants exist", () => {
    expect(imageSources(storage, { objectKey: OBJECT_KEY, url: null, variantsVersion: null })).toEqual({
      url: `https://cdn.example/${OBJECT_KEY}`,
      variants: null,
    });
  });

  it("offers a CDN URL per variant once they do", () => {
    const stem = `https://cdn.example/properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222/v1`;

    expect(imageSources(storage, { objectKey: OBJECT_KEY, url: null, variantsVersion: 1 })).toEqual({
      url: `https://cdn.example/${OBJECT_KEY}`,
      variants: {
        thumb: `${stem}/thumb.webp`,
        card: `${stem}/card.webp`,
        detail: `${stem}/detail.webp`,
        hero: `${stem}/hero.webp`,
      },
    });
  });

  it("keeps the seeded catalogue's remote URL, without variants", () => {
    expect(
      imageSources(storage, {
        objectKey: null,
        url: "https://images.unsplash.com/photo-1",
        variantsVersion: null,
      }),
    ).toEqual({ url: "https://images.unsplash.com/photo-1", variants: null });
  });
});
