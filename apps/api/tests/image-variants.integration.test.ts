import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { propertyImages } from "../src/infrastructure/database/schema";
import { VARIANTS_VERSION } from "../src/modules/properties/images/image-variants";
import { ImageVariantsService } from "../src/modules/properties/images/image-variants.service";
import { findPendingImages } from "../src/modules/properties/images/pending-variants";
import {
  DATABASE,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";

/**
 * That every view of a Listing photo offers its variants once they exist, and
 * only the original before — including the Search query, which reads the
 * cover with hand-written SQL rather than through Drizzle.
 *
 * The variants themselves are not generated here: CI has no bucket. Their
 * generation is covered by image-variants-service.test.ts; this marks a row
 * as processed and checks what the API makes of it.
 */

let app: NestFastifyApplication;
let database: Database;
let host: TestHost;
let property: { id: string; slug: string };
let coverId: string;
let coverKey: string;

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
  host = await registerHost(app, "image-variants");
  property = await createPublishedProperty(app, host, "Variants Loft");

  const [cover] = await database.db
    .select({ id: propertyImages.id, objectKey: propertyImages.objectKey })
    .from(propertyImages)
    .where(eq(propertyImages.propertyId, property.id))
    .orderBy(asc(propertyImages.position))
    .limit(1);
  coverId = cover.id;
  coverKey = cover.objectKey!;
});

afterAll(async () => {
  await cleanupHosts(database, [host]);
  await app.close();
});

async function detail() {
  const response = await app.inject({ method: "GET", url: `/api/properties/${property.slug}` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function searchCover() {
  const response = await app.inject({ method: "GET", url: "/api/search?limit=200" });
  expect(response.statusCode).toBe(200);
  const items = response.json().items as { id: string; coverImage: unknown }[];
  return items.find((item) => item.id === property.id)?.coverImage as {
    url: string;
    variants: Record<string, string> | null;
  };
}

describe("photo variants in the API", () => {
  it("offers only the original before variants exist", async () => {
    const listing = await detail();
    expect(listing.images).toHaveLength(3);
    for (const image of listing.images) expect(image.variants).toBeNull();

    const cover = await searchCover();
    expect(cover.url).toContain(coverKey);
    expect(cover.variants).toBeNull();
  });

  it("lists every stored photo without current variants as pending", async () => {
    const pending = (await findPendingImages(database, 1000)).map((row) => row.id);
    expect(pending).toContain(coverId);
  });

  it("offers the variants everywhere once the cover has them", async () => {
    await database.db
      .update(propertyImages)
      .set({ variantsVersion: VARIANTS_VERSION, width: 2000, height: 1500 })
      .where(eq(propertyImages.id, coverId));

    const stem = coverKey.replace(/\.jpg$/, `/v${VARIANTS_VERSION}`);
    const expected = {
      thumb: expect.stringMatching(new RegExp(`${stem}/thumb\\.webp$`)),
      card: expect.stringMatching(new RegExp(`${stem}/card\\.webp$`)),
      detail: expect.stringMatching(new RegExp(`${stem}/detail\\.webp$`)),
      hero: expect.stringMatching(new RegExp(`${stem}/hero\\.webp$`)),
    };

    const listing = await detail();
    expect(listing.images[0].variants).toEqual(expected);
    expect(listing.coverImage.variants).toEqual(expected);
    // The original stays available as the fallback.
    expect(listing.images[0].url).toContain(coverKey);
    expect(listing.images[1].variants).toBeNull();

    expect((await searchCover()).variants).toEqual(expected);

    const hostView = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}`,
      cookies: host.cookies,
    });
    expect(hostView.json().images[0].variants).toEqual(expected);
  });

  it("stops listing a processed photo as pending", async () => {
    const pending = (await findPendingImages(database, 1000)).map((row) => row.id);
    expect(pending).not.toContain(coverId);

    const others = await database.db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(and(eq(propertyImages.propertyId, property.id)));
    for (const { id } of others.filter((row) => row.id !== coverId)) {
      expect(pending).toContain(id);
    }
  });

  it("removes a deleted photo's variants along with the original", async () => {
    const removeVariants = vi
      .spyOn(app.get(ImageVariantsService), "removeVariants")
      .mockResolvedValue(undefined);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/host/properties/${property.id}/images/${coverId}`,
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(removeVariants).toHaveBeenCalledWith(coverKey, property.id);
    removeVariants.mockRestore();
  });
});
