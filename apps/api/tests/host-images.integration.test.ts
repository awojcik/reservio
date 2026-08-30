import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { propertyImages } from "../src/infrastructure/database/schema";
import {
  DATABASE,
  cleanupHosts,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";

let app: NestFastifyApplication;
let database: Database;
let hostA: TestHost;
let hostB: TestHost;
const created: TestHost[] = [];

async function createDraft(host: TestHost): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/host/properties",
    cookies: host.cookies,
    payload: { title: "Obiekt na zdjęcia", propertyType: "APARTMENT" },
  });
  return response.json().id;
}

/** Registers an image without a real upload; presigning is covered separately. */
async function seedImages(propertyId: string, count: number) {
  const rows = Array.from({ length: count }, (_, index) => ({
    propertyId,
    objectKey: `properties/${propertyId}/${crypto.randomUUID()}.jpg`,
    altText: `Zdjęcie ${index + 1}`,
    position: index,
  }));
  await database.db.insert(propertyImages).values(rows);
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);

  hostA = await registerHost(app, "images-owner");
  hostB = await registerHost(app, "images-stranger");
  created.push(hostA, hostB);
});

afterAll(async () => {
  await cleanupHosts(database, created);
  await app.close();
});

describe("property images", () => {
  it("issues an upload URL only for the Host's own Property", async () => {
    const propertyId = await createDraft(hostA);

    const own = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/images/upload-url`,
      cookies: hostA.cookies,
      payload: { fileName: "salon.jpg", contentType: "image/jpeg", sizeBytes: 2_450_000 },
    });

    expect(own.statusCode).toBe(200);
    const ticket = own.json();
    // The key is minted from the Property id, never from the file name.
    expect(ticket.objectKey).toMatch(
      new RegExp(`^properties/${propertyId}/[0-9a-f-]{36}\\.jpg$`),
    );
    expect(ticket.objectKey).not.toContain("salon");
    expect(ticket.uploadUrl).toContain("X-Amz-Signature");

    const foreign = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/images/upload-url`,
      cookies: hostB.cookies,
      payload: { fileName: "salon.jpg", contentType: "image/jpeg", sizeBytes: 1000 },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("rejects a disallowed MIME type", async () => {
    const propertyId = await createDraft(hostA);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/images/upload-url`,
      cookies: hostA.cookies,
      payload: { fileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 1000 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects an image larger than 10 MB", async () => {
    const propertyId = await createDraft(hostA);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/images/upload-url`,
      cookies: hostA.cookies,
      payload: {
        fileName: "wielkie.jpg",
        contentType: "image/jpeg",
        sizeBytes: 11 * 1024 * 1024,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses an objectKey belonging to another Property", async () => {
    const mine = await createDraft(hostA);
    const other = await createDraft(hostA);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${mine}/images`,
      cookies: hostA.cookies,
      payload: { objectKey: `properties/${other}/${crypto.randomUUID()}.jpg` },
    });

    expect(response.statusCode).toBe(400);
  });

  it("stops at 30 images per Property", async () => {
    const propertyId = await createDraft(hostA);
    await seedImages(propertyId, 30);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/images/upload-url`,
      cookies: hostA.cookies,
      payload: { fileName: "kolejne.jpg", contentType: "image/jpeg", sizeBytes: 1000 },
    });

    expect(response.statusCode).toBe(409);
  });

  it("reorders transactionally and keeps position 0 as the cover", async () => {
    const propertyId = await createDraft(hostA);
    await seedImages(propertyId, 3);

    const before = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    const ids = before.json().images.map((image: { id: string }) => image.id);

    const reordered = await app.inject({
      method: "PUT",
      url: `/api/host/properties/${propertyId}/images/order`,
      cookies: hostA.cookies,
      payload: { imageIds: [...ids].reverse() },
    });

    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().map((image: { id: string }) => image.id)).toEqual(
      [...ids].reverse(),
    );
    expect(reordered.json()[0].position).toBe(0);
  });

  it("refuses a reorder with duplicates or a missing image", async () => {
    const propertyId = await createDraft(hostA);
    await seedImages(propertyId, 3);

    const detail = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    const ids = detail.json().images.map((image: { id: string }) => image.id);

    const duplicated = await app.inject({
      method: "PUT",
      url: `/api/host/properties/${propertyId}/images/order`,
      cookies: hostA.cookies,
      payload: { imageIds: [ids[0], ids[0], ids[1]] },
    });
    const incomplete = await app.inject({
      method: "PUT",
      url: `/api/host/properties/${propertyId}/images/order`,
      cookies: hostA.cookies,
      payload: { imageIds: [ids[0]] },
    });

    expect(duplicated.statusCode).toBe(400);
    expect(incomplete.statusCode).toBe(400);
  });

  it("closes the gap in positions after a delete", async () => {
    const propertyId = await createDraft(hostA);
    await seedImages(propertyId, 3);

    const detail = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    const middle = detail.json().images[1].id;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/host/properties/${propertyId}/images/${middle}`,
      cookies: hostA.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((image: { position: number }) => image.position)).toEqual([
      0, 1,
    ]);

    const rows = await database.db
      .select()
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId));
    expect(rows).toHaveLength(2);
  });

  it("keeps another Host away from image operations", async () => {
    const propertyId = await createDraft(hostA);
    await seedImages(propertyId, 2);

    const detail = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    const imageId = detail.json().images[0].id;

    const attempts = await Promise.all([
      app.inject({
        method: "DELETE",
        url: `/api/host/properties/${propertyId}/images/${imageId}`,
        cookies: hostB.cookies,
      }),
      app.inject({
        method: "PUT",
        url: `/api/host/properties/${propertyId}/images/order`,
        cookies: hostB.cookies,
        payload: { imageIds: [imageId] },
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${propertyId}/images`,
        cookies: hostB.cookies,
        payload: { objectKey: `properties/${propertyId}/${crypto.randomUUID()}.jpg` },
      }),
    ]);

    for (const attempt of attempts) expect(attempt.statusCode).toBe(404);
  });
});
