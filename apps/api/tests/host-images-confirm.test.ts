import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { HostImagesService } from "../src/modules/properties/host/host-images.service";
import type { Database } from "../src/infrastructure/database/connection";
import type { HostPropertiesService } from "../src/modules/properties/host/host-properties.service";
import type { ObjectStorage, StoredObjectHead } from "../src/modules/storage/object-storage";

/**
 * That `confirm` actually consults the bytes, and what it does when they are
 * wrong.
 *
 * The pure rules live in uploaded-image.test.ts; this covers the wiring, which
 * is the half that cannot be reasoned about: a validator nobody calls looks
 * exactly like a validator that passes.
 *
 * Stubbed rather than run against a real bucket because CI has neither MinIO
 * nor Spaces, and the integration suite seeds images straight into the
 * database for the same reason.
 */

const PROPERTY_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_KEY = `properties/${PROPERTY_ID}/22222222-2222-4222-8222-222222222222.jpg`;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** Drizzle's builder is fluent and awaited at the end; every query here wants an empty result. */
function emptyQuery() {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return chain;
}

function serviceWith(object: StoredObjectHead | null) {
  const inserted: unknown[] = [];
  const storage = {
    inspectObject: vi.fn(async () => object),
    deleteObject: vi.fn(async () => undefined),
    createPresignedUpload: vi.fn(),
    getPublicUrl: (key: string) => `https://cdn.example/${key}`,
  } as unknown as ObjectStorage & {
    inspectObject: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };

  const database = {
    db: {
      select: () => emptyQuery(),
      insert: () => ({
        values: async (row: unknown) => {
          inserted.push(row);
        },
      }),
    },
  } as unknown as Database;

  const hostProperties = {
    findOwned: vi.fn(async () => ({ id: PROPERTY_ID })),
    loadImages: vi.fn(async () => []),
  } as unknown as HostPropertiesService;

  const service = new HostImagesService(database, storage, hostProperties);
  return { service, storage, inserted };
}

describe("confirm, against the bytes that were uploaded", () => {
  it("records a real photo", async () => {
    const { service, storage, inserted } = serviceWith({ head: JPEG, sizeBytes: 2048 });

    await service.confirm("host", PROPERTY_ID, { objectKey: OBJECT_KEY });

    expect(storage.inspectObject).toHaveBeenCalledWith(OBJECT_KEY);
    expect(inserted).toHaveLength(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("refuses a file that is not an image, and writes no row", async () => {
    const notAnImage = new Uint8Array(Buffer.from("MZ\u0090\u0000"));
    const { service, inserted } = serviceWith({ head: notAnImage, sizeBytes: 4096 });

    await expect(service.confirm("host", PROPERTY_ID, { objectKey: OBJECT_KEY })).rejects.toThrow(
      BadRequestException,
    );
    expect(inserted).toHaveLength(0);
  });

  /**
   * The object is addressable at a public URL whether or not a row points at
   * it, so a rejected upload has to go.
   */
  it("deletes what it refused", async () => {
    const { service, storage } = serviceWith({ head: new Uint8Array([0, 1]), sizeBytes: 10 });

    await expect(service.confirm("host", PROPERTY_ID, { objectKey: OBJECT_KEY })).rejects.toThrow();
    expect(storage.deleteObject).toHaveBeenCalledWith(OBJECT_KEY);
  });

  it("refuses a key nothing was uploaded to, and has nothing to delete", async () => {
    const { service, storage } = serviceWith(null);

    await expect(service.confirm("host", PROPERTY_ID, { objectKey: OBJECT_KEY })).rejects.toThrow(
      /Nie znaleziono/,
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  /**
   * A failed cleanup must not change the error the Host sees: "not an image"
   * is actionable, "storage unavailable" is not.
   */
  it("still reports the real reason when the cleanup fails", async () => {
    const { service, storage } = serviceWith({ head: new Uint8Array([0, 1]), sizeBytes: 10 });
    (storage.deleteObject as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("AccessDenied"));

    await expect(service.confirm("host", PROPERTY_ID, { objectKey: OBJECT_KEY })).rejects.toThrow(
      /nie jest obrazem/,
    );
  });
});
