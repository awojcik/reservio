import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { bookings, properties, propertyImages } from "../src/infrastructure/database/schema";
import { IMAGE_VARIANTS_QUEUE } from "../src/infrastructure/queue/queue.module";
import { ArchivedImagesService } from "../src/modules/properties/images/archived-images.service";
import { ImageVariantsService } from "../src/modules/properties/images/image-variants.service";
import { variantKeys } from "../src/modules/properties/images/image-variants";
import type { ObjectStorage } from "../src/modules/storage/object-storage";
import {
  DATABASE,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";

/**
 * What archiving does to a Property's photos in storage.
 *
 * The queries run against the real database — which photos belong to the
 * Property, which originals a Booking still points at, which Properties are
 * due. Storage is a recorder: CI has no bucket, and what matters is exactly
 * which keys would be deleted.
 */

let app: NestFastifyApplication;
let database: Database;
let host: TestHost;
let archived: { id: string; slug: string };
let neighbour: { id: string; slug: string };
let images: { id: string; objectKey: string }[];
let neighbourKeys: string[];
let bookingId: string;

function recorder(options: { failOn?: string } = {}) {
  const deleted: string[] = [];
  const storage = {
    deleteObject: vi.fn(async (key: string) => {
      if (key === options.failOn) throw new Error("ServiceUnavailable");
      deleted.push(key);
    }),
    getPublicUrl: (key: string) => `https://cdn.example/${key}`,
  } as unknown as ObjectStorage;
  const service = new ArchivedImagesService(database, storage, {} as never);
  return { service, deleted };
}

async function imagesOf(propertyId: string) {
  const rows = await database.db
    .select({ id: propertyImages.id, objectKey: propertyImages.objectKey })
    .from(propertyImages)
    .where(eq(propertyImages.propertyId, propertyId))
    .orderBy(asc(propertyImages.position));
  return rows.map((row) => ({ id: row.id, objectKey: row.objectKey! }));
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
  host = await registerHost(app, "archived-images");
  archived = await createPublishedProperty(app, host, "Archived Loft");
  neighbour = await createPublishedProperty(app, host, "Neighbour Loft");

  images = await imagesOf(archived.id);
  neighbourKeys = (await imagesOf(neighbour.id)).map((image) => image.objectKey);
  await database.db
    .update(propertyImages)
    .set({ variantsVersion: 1 })
    .where(inArray(propertyImages.propertyId, [archived.id, neighbour.id]));

  // A Guest booked while the first photo was the cover; "Moje podróże" shows it.
  const [booking] = await database.db
    .insert(bookings)
    .values({
      publicReference: `RZ-ARCH-${Date.now()}`,
      propertyId: archived.id,
      hostId: host.hostId,
      bookingMode: "REQUEST_TO_BOOK",
      status: "COMPLETED",
      checkIn: "2026-07-01",
      checkOut: "2026-07-04",
      adults: 2,
      guestName: "Gość Testowy",
      guestEmail: "gosc@example.test",
      propertyTitleSnapshot: "Archived Loft",
      coverImageUrlSnapshot: `https://bucket.fra1.digitaloceanspaces.com/${images[0].objectKey}`,
      accommodationAmountMinor: 135_000,
      cleaningFeeAmountMinor: 10_000,
      totalAmountMinor: 145_000,
      currency: "PLN",
    })
    .returning({ id: bookings.id });
  bookingId = booking.id;
});

afterAll(async () => {
  // Bookings restrict the Property's deletion, on purpose.
  await database.db.delete(bookings).where(eq(bookings.id, bookingId));
  await cleanupHosts(database, [host]);
  await app.close();
});

describe("archiving a Property", () => {
  it("queues the photo cleanup on the transition, once", async () => {
    const requestCleanup = vi
      .spyOn(app.get(ArchivedImagesService), "requestCleanup")
      .mockResolvedValue(undefined);

    const first = await app.inject({
      method: "POST",
      url: `/api/host/properties/${archived.id}/archive`,
      cookies: host.cookies,
    });
    const again = await app.inject({
      method: "POST",
      url: `/api/host/properties/${archived.id}/archive`,
      cookies: host.cookies,
    });

    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(requestCleanup).toHaveBeenCalledTimes(1);
    expect(requestCleanup).toHaveBeenCalledWith(archived.id);
    requestCleanup.mockRestore();
  });

  it("refuses new photos once archived", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${archived.id}/images/upload-url`,
      cookies: host.cookies,
      payload: { fileName: "nowe.jpg", contentType: "image/jpeg", sizeBytes: 100_000 },
    });

    expect(response.statusCode).toBe(409);
  });

  it("is found by the sweep while its photos are still stored", async () => {
    const requested: string[] = [];
    const sweep = recorder().service;
    vi.spyOn(sweep, "requestCleanup").mockImplementation(async (id) => {
      requested.push(id);
    });

    await sweep.enqueueDue();

    expect(requested).toContain(archived.id);
    expect(requested).not.toContain(neighbour.id);
  });
});

/**
 * Against the real Redis: BullMQ validates custom job ids, and an id it
 * rejects fails only at enqueue time — exactly where archive swallows the
 * error and moves on.
 */
describe("the jobs BullMQ is asked to hold", () => {
  it("accepts a cleanup job and a variants job", async () => {
    const queue = app.get(IMAGE_VARIANTS_QUEUE);

    await app.get(ArchivedImagesService).requestCleanup(neighbour.id);
    await app.get(ImageVariantsService).enqueue(images[0].id);

    const cleanup = await queue.getJob(`cleanup-archived-${neighbour.id}`);
    const variants = await queue.getJob(`variants-${images[0].id}-v1`);
    expect(cleanup).toBeDefined();
    expect(variants).toBeDefined();
    await cleanup!.remove();
    await variants!.remove();
  });
});

describe("cleaning up an archived Property's photos", () => {
  it("stops at a storage failure without marking the work done", async () => {
    const failing = recorder({ failOn: variantKeys(images[1].objectKey, 1)[2] });

    await expect(failing.service.cleanup(archived.id)).rejects.toThrow("ServiceUnavailable");

    const [row] = await database.db
      .select({ imagesCleanedAt: properties.imagesCleanedAt })
      .from(properties)
      .where(eq(properties.id, archived.id));
    expect(row.imagesCleanedAt).toBeNull();
  });

  it("removes every variant and every original no Booking points at", async () => {
    const { service, deleted } = recorder();

    const outcome = await service.cleanup(archived.id);

    expect(outcome).toEqual({ status: "cleaned", images: 3, deleted: 14, originalsKept: 1 });
    for (const image of images) {
      // thumb, card, detail, hero — of every photo, the booked cover included.
      for (const key of variantKeys(image.objectKey, 1)) expect(deleted).toContain(key);
    }
    expect(deleted).toContain(images[1].objectKey);
    expect(deleted).toContain(images[2].objectKey);
  });

  it("keeps the original a Guest's Booking still shows", async () => {
    const { service, deleted } = recorder();
    await database.db
      .update(properties)
      .set({ imagesCleanedAt: null })
      .where(eq(properties.id, archived.id));

    await service.cleanup(archived.id);

    expect(deleted).not.toContain(images[0].objectKey);
  });

  it("never touches another Property's photos", async () => {
    const { service, deleted } = recorder();
    await database.db
      .update(properties)
      .set({ imagesCleanedAt: null })
      .where(eq(properties.id, archived.id));

    await service.cleanup(archived.id);

    for (const key of neighbourKeys) {
      expect(deleted).not.toContain(key);
      for (const variant of variantKeys(key, 1)) expect(deleted).not.toContain(variant);
    }
    expect(deleted.every((key) => key.startsWith(`properties/${archived.id}/`))).toBe(true);
  });

  it("does nothing the second time", async () => {
    const { service, deleted } = recorder();

    await expect(service.cleanup(archived.id)).resolves.toEqual({
      status: "skipped",
      reason: "already_cleaned",
    });
    expect(deleted).toHaveLength(0);
  });

  it("never cleans a Property that is not archived", async () => {
    const { service, deleted } = recorder();

    await expect(service.cleanup(neighbour.id)).resolves.toEqual({
      status: "skipped",
      reason: "not_archived",
    });
    expect(deleted).toHaveLength(0);
  });

  it("drops out of the sweep once cleaned", async () => {
    const requested: string[] = [];
    const sweep = recorder().service;
    vi.spyOn(sweep, "requestCleanup").mockImplementation(async (id) => {
      requested.push(id);
    });

    await sweep.enqueueDue();

    expect(requested).not.toContain(archived.id);
  });
});
