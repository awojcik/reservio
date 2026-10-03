import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { propertyImages } from "../src/infrastructure/database/schema";
import {
  COMPLETE_PROPERTY_PATCH,
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

/** Adds images straight to the database — object storage is covered separately. */
async function giveImages(propertyId: string, count: number): Promise<void> {
  await database.db.insert(propertyImages).values(
    Array.from({ length: count }, (_, index) => ({
      propertyId,
      objectKey: `properties/${propertyId}/${crypto.randomUUID()}.jpg`,
      altText: `Zdjęcie ${index + 1}`,
      position: index,
    })),
  );
}

async function createDraft(host: TestHost, title: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/host/properties",
    cookies: host.cookies,
    payload: { title, propertyType: "APARTMENT" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id;
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);

  hostA = await registerHost(app, "owner");
  hostB = await registerHost(app, "stranger");
  created.push(hostA, hostB);
});

afterAll(async () => {
  await cleanupHosts(database, created);
  await app.close();
});

describe("host authorization", () => {
  it("keeps one Host out of another Host's Property", async () => {
    const propertyId = await createDraft(hostA, "Obiekt Hosta A");

    const own = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    expect(own.statusCode).toBe(200);

    // 404 rather than 403 — a 403 would confirm the Property exists.
    const attempts = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/host/properties/${propertyId}`,
        cookies: hostB.cookies,
      }),
      app.inject({
        method: "PATCH",
        url: `/api/host/properties/${propertyId}`,
        cookies: hostB.cookies,
        payload: { title: "Przejęte" },
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${propertyId}/publish`,
        cookies: hostB.cookies,
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${propertyId}/images/upload-url`,
        cookies: hostB.cookies,
        payload: { fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 1000 },
      }),
    ]);

    for (const attempt of attempts) expect(attempt.statusCode).toBe(404);

    const untouched = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    expect(untouched.json().title).toBe("Obiekt Hosta A");
  });

  it("lists only the Property of the signed-in Host", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/host/properties",
      cookies: hostB.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(0);
  });

  it("requires a session for every host route", async () => {
    const response = await app.inject({ method: "GET", url: "/api/host/properties" });
    expect(response.statusCode).toBe(401);
  });
});

describe("property lifecycle", () => {
  it("creates a DRAFT that the public API does not serve", async () => {
    const propertyId = await createDraft(hostA, "Szkic niepubliczny");

    const detail = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    const body = detail.json();

    expect(body.status).toBe("DRAFT");
    expect(body.publishReadiness.ready).toBe(false);

    const publicResponse = await app.inject({
      method: "GET",
      url: `/api/properties/${body.slug}`,
    });
    expect(publicResponse.statusCode).toBe(404);
  });

  it("accepts a partial update without demanding publish completeness", async () => {
    const propertyId = await createDraft(hostA, "Szkic częściowy");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { capacity: { maxGuests: 6 } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().capacity.maxGuests).toBe(6);
    expect(response.json().status).toBe("DRAFT");
  });

  it("rejects an empty numeric field instead of silently saving zero", async () => {
    const propertyId = await createDraft(hostA, "Puste pole liczbowe");

    await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { capacity: { bathrooms: 2 } },
    });

    // "" used to be coerced to 0, so a cleared field saved as zero and only
    // surfaced later as a publish rejection the Host could not explain.
    const response = await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { capacity: { bathrooms: "" } },
    });
    expect(response.statusCode).toBe(400);

    const after = await app.inject({
      method: "GET",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
    });
    expect(after.json().capacity.bathrooms).toBe(2);
  });

  it("still accepts a numeric string, as a query-style client would send", async () => {
    const propertyId = await createDraft(hostA, "Liczba jako tekst");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { capacity: { beds: "3" }, pricing: { baseDailyRateAmountMinor: "45000" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().capacity.beds).toBe(3);
    expect(response.json().pricing.baseDailyRateAmountMinor).toBe(45_000);
  });

  it("rejects a non-numeric value outright", async () => {
    const propertyId = await createDraft(hostA, "Nie-liczba");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { capacity: { beds: "dwa" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses to change hostId or status through PATCH", async () => {
    const propertyId = await createDraft(hostA, "Szkic chroniony");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { status: "PUBLISHED", hostId: hostB.hostId, title: "Nadal szkic" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("DRAFT");
    expect(response.json().title).toBe("Nadal szkic");
  });

  it("rejects publishing an incomplete Property with 422 and the missing fields", async () => {
    const propertyId = await createDraft(hostA, "Niekompletny");

    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/publish`,
      cookies: hostA.cookies,
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.code).toBe("PROPERTY_NOT_READY_FOR_PUBLISH");
    expect(body.errors).toContainEqual({
      field: "images",
      code: "MINIMUM_IMAGES_REQUIRED",
      required: 3,
    });
  });

  it("walks a complete Property through publish, unpublish and archive", async () => {
    const propertyId = await createDraft(hostA, "Pełny obiekt testowy");

    await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: COMPLETE_PROPERTY_PATCH,
    });
    await giveImages(propertyId, 3);

    const published = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/publish`,
      cookies: hostA.cookies,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe("PUBLISHED");

    const slug = published.json().slug;

    // Visible to the public with no reindex, seed or restart.
    const search = await app.inject({
      method: "GET",
      url: "/api/search?destination=Brzezno&limit=200",
    });
    expect(search.json().items.map((item: { slug: string }) => item.slug)).toContain(slug);

    const publicDetail = await app.inject({ method: "GET", url: `/api/properties/${slug}` });
    expect(publicDetail.statusCode).toBe(200);
    // The private address never crosses into the public contract.
    expect(publicDetail.json()).not.toHaveProperty("addressLine1");
    expect(publicDetail.json()).not.toHaveProperty("postalCode");

    const unpublished = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/unpublish`,
      cookies: hostA.cookies,
    });
    expect(unpublished.json().status).toBe("SUSPENDED");

    const afterUnpublish = await app.inject({
      method: "GET",
      url: "/api/search?destination=Brzezno&limit=200",
    });
    expect(
      afterUnpublish.json().items.map((item: { slug: string }) => item.slug),
    ).not.toContain(slug);
    expect(
      (await app.inject({ method: "GET", url: `/api/properties/${slug}` })).statusCode,
    ).toBe(404);

    // Publishing again keeps the slug it earned on the first publish.
    const republished = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/publish`,
      cookies: hostA.cookies,
    });
    expect(republished.json()).toMatchObject({ status: "PUBLISHED", slug });

    const archived = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/archive`,
      cookies: hostA.cookies,
    });
    expect(archived.json().status).toBe("ARCHIVED");
    expect(
      (await app.inject({ method: "GET", url: `/api/properties/${slug}` })).statusCode,
    ).toBe(404);

    // An archived Listing is history, not something to put back on the market.
    const republishArchived = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/publish`,
      cookies: hostA.cookies,
    });
    expect(republishArchived.statusCode).toBe(409);
  });

  it("keeps the slug stable once the Property has been published", async () => {
    const propertyId = await createDraft(hostA, "Pierwotna nazwa obiektu");

    await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: COMPLETE_PROPERTY_PATCH,
    });
    await giveImages(propertyId, 3);

    const published = await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/publish`,
      cookies: hostA.cookies,
    });
    const slug = published.json().slug;

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/host/properties/${propertyId}`,
      cookies: hostA.cookies,
      payload: { title: "Zupełnie inna nazwa obiektu" },
    });

    expect(renamed.json().title).toBe("Zupełnie inna nazwa obiektu");
    expect(renamed.json().slug).toBe(slug);
  });
});
