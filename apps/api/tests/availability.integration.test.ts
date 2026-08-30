import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { availabilityBlocks, externalCalendars } from "../src/infrastructure/database/schema";
import {
  DATABASE,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";

let app: NestFastifyApplication;
let database: Database;
let hostA: TestHost;
let hostB: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

type Block = { startDate: string; endDate: string; sourceType: string; note: string | null };

async function calendar(host: TestHost, propertyId: string): Promise<Block[]> {
  const response = await app.inject({
    method: "GET",
    url: `/api/host/properties/${propertyId}/calendar?from=2026-01-01&to=2027-01-01`,
    cookies: host.cookies,
  });
  expect(response.statusCode).toBe(200);
  return response.json().blocks;
}

async function block(startDate: string, endDate: string, note?: string) {
  return app.inject({
    method: "POST",
    url: `/api/host/properties/${property.id}/availability/block`,
    cookies: hostA.cookies,
    payload: { startDate, endDate, ...(note ? { note } : {}) },
  });
}

async function unblock(startDate: string, endDate: string) {
  return app.inject({
    method: "POST",
    url: `/api/host/properties/${property.id}/availability/unblock`,
    cookies: hostA.cookies,
    payload: { startDate, endDate },
  });
}

async function clearBlocks() {
  await database.db.delete(availabilityBlocks);
}

/** Writes an EXTERNAL_CALENDAR block directly; sync itself is tested separately. */
async function seedExternalBlock(startDate: string, endDate: string): Promise<string> {
  const [calendarRow] = await database.db
    .insert(externalCalendars)
    .values({
      propertyId: property.id,
      provider: "AIRBNB",
      name: "Feed testowy",
      importUrlEncrypted: "v1.placeholder",
    })
    .returning();

  await database.db.execute(
    (await import("drizzle-orm")).sql`
      INSERT INTO availability_blocks
        (property_id, source_type, date_range, external_calendar_id, external_event_uid)
      VALUES (${property.id}, 'EXTERNAL_CALENDAR',
              daterange(${startDate}::date, ${endDate}::date, '[)'),
              ${calendarRow.id}, ${"uid-" + startDate})
    `,
  );

  return calendarRow.id;
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);

  hostA = await registerHost(app, "cal-owner");
  hostB = await registerHost(app, "cal-stranger");
  created.push(hostA, hostB);

  property = await createPublishedProperty(app, hostA, "Obiekt kalendarzowy", {
    address: {
      addressLine1: "ul. Kalendarzowa 1",
      postalCode: "80-002",
      city: "Gdańsk",
      district: "Testowo",
      countryCode: "PL",
      timeZone: "Europe/Warsaw",
      latitude: 54.4,
      longitude: 18.62,
    },
  });
});

afterAll(async () => {
  await cleanupHosts(database, created);
  await app.close();
});

describe("manual blocks", () => {
  it("creates a HOST_BLOCK", async () => {
    await clearBlocks();
    const response = await block("2026-09-12", "2026-09-16", "Wyjazd właściciela");

    expect(response.statusCode).toBe(200);
    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({
        startDate: "2026-09-12",
        endDate: "2026-09-16",
        sourceType: "HOST_BLOCK",
        note: "Wyjazd właściciela",
      }),
    ]);
  });

  it("rejects an inverted or empty range", async () => {
    await clearBlocks();
    expect((await block("2026-09-16", "2026-09-12")).statusCode).toBe(400);
    expect((await block("2026-09-16", "2026-09-16")).statusCode).toBe(400);
  });

  it("merges an adjacent block", async () => {
    await clearBlocks();
    await block("2026-09-10", "2026-09-12");
    await block("2026-09-12", "2026-09-15");

    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({ startDate: "2026-09-10", endDate: "2026-09-15" }),
    ]);
  });

  it("merges an overlapping block", async () => {
    await clearBlocks();
    await block("2026-09-10", "2026-09-14");
    await block("2026-09-12", "2026-09-18");

    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({ startDate: "2026-09-10", endDate: "2026-09-18" }),
    ]);
  });

  it("never merges a manual block with an external one", async () => {
    await clearBlocks();
    await seedExternalBlock("2026-09-12", "2026-09-16");
    await block("2026-09-16", "2026-09-20");

    const blocks = await calendar(hostA, property.id);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((entry) => entry.sourceType).sort()).toEqual([
      "EXTERNAL_CALENDAR",
      "HOST_BLOCK",
    ]);
  });
});

describe("manual unblock", () => {
  it("removes a block entirely", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");
    await unblock("2026-09-01", "2026-10-01");

    expect(await calendar(hostA, property.id)).toEqual([]);
  });

  it("trims the left side", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");
    await unblock("2026-09-10", "2026-09-14");

    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({ startDate: "2026-09-14", endDate: "2026-09-16" }),
    ]);
  });

  it("trims the right side", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");
    await unblock("2026-09-14", "2026-09-20");

    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({ startDate: "2026-09-12", endDate: "2026-09-14" }),
    ]);
  });

  it("splits a block when the hole is in the middle", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");
    await unblock("2026-09-13", "2026-09-14");

    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({ startDate: "2026-09-12", endDate: "2026-09-13" }),
      expect.objectContaining({ startDate: "2026-09-14", endDate: "2026-09-16" }),
    ]);
  });

  it("is a no-op when nothing overlaps", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");
    await unblock("2026-10-01", "2026-10-05");

    expect(await calendar(hostA, property.id)).toEqual([
      expect.objectContaining({ startDate: "2026-09-12", endDate: "2026-09-16" }),
    ]);
  });

  it("leaves external blocks untouched", async () => {
    await clearBlocks();
    await seedExternalBlock("2026-09-12", "2026-09-16");
    await unblock("2026-09-01", "2026-10-01");

    const blocks = await calendar(hostA, property.id);
    expect(blocks).toEqual([
      expect.objectContaining({ sourceType: "EXTERNAL_CALENDAR" }),
    ]);
  });
});

describe("ownership", () => {
  it("keeps another Host away from the calendar", async () => {
    const attempts = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/host/properties/${property.id}/calendar?from=2026-09-01&to=2026-10-01`,
        cookies: hostB.cookies,
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${property.id}/availability/block`,
        cookies: hostB.cookies,
        payload: { startDate: "2026-09-12", endDate: "2026-09-16" },
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${property.id}/availability/unblock`,
        cookies: hostB.cookies,
        payload: { startDate: "2026-09-12", endDate: "2026-09-16" },
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${property.id}/external-calendars`,
        cookies: hostB.cookies,
        payload: { provider: "AIRBNB", name: "Obcy", importUrl: "https://example.com/c.ics" },
      }),
      app.inject({
        method: "POST",
        url: `/api/host/properties/${property.id}/calendar-export`,
        cookies: hostB.cookies,
      }),
    ]);

    for (const attempt of attempts) expect(attempt.statusCode).toBe(404);
  });

  it("requires a session at all", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/calendar?from=2026-09-01&to=2026-10-01`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("search and public availability", () => {
  async function searchSlugs(query: string): Promise<string[]> {
    const response = await app.inject({ method: "GET", url: `/api/search?${query}&limit=200` });
    expect(response.statusCode).toBe(200);
    return response.json().items.map((item: { slug: string }) => item.slug);
  }

  it("returns an unblocked Property", async () => {
    await clearBlocks();
    expect(await searchSlugs("checkIn=2026-09-13&checkOut=2026-09-15")).toContain(property.slug);
  });

  it("filters out a Property with an overlapping HOST_BLOCK", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");

    expect(await searchSlugs("checkIn=2026-09-13&checkOut=2026-09-15")).not.toContain(
      property.slug,
    );
  });

  it("still returns a Property for an adjacent Stay", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");

    // The block ends where the Stay begins — half-open means no collision.
    expect(await searchSlugs("checkIn=2026-09-16&checkOut=2026-09-18")).toContain(property.slug);
  });

  it("filters out an EXTERNAL_CALENDAR block just the same", async () => {
    await clearBlocks();
    await seedExternalBlock("2026-09-12", "2026-09-16");

    expect(await searchSlugs("checkIn=2026-09-13&checkOut=2026-09-15")).not.toContain(
      property.slug,
    );
  });

  it("ignores availability when no dates are given", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");

    expect(await searchSlugs("destination=Testowo")).toContain(property.slug);
  });

  it("reports availability on the Property detail with the same semantics", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-16");

    const blocked = await app.inject({
      method: "GET",
      url: `/api/properties/${property.slug}?checkIn=2026-09-13&checkOut=2026-09-15`,
    });
    const free = await app.inject({
      method: "GET",
      url: `/api/properties/${property.slug}?checkIn=2026-09-16&checkOut=2026-09-18`,
    });
    const noStay = await app.inject({ method: "GET", url: `/api/properties/${property.slug}` });

    expect(blocked.json().available).toBe(false);
    expect(free.json().available).toBe(true);
    expect(noStay.json().available).toBeNull();
  });

  it("exposes taken dates publicly without revealing why", async () => {
    await clearBlocks();
    await block("2026-09-12", "2026-09-14", "Prywatna notatka");
    await seedExternalBlock("2026-09-14", "2026-09-16");

    const response = await app.inject({
      method: "GET",
      url: `/api/properties/${property.slug}/availability?from=2026-09-01&to=2026-10-01`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Merged into one span; a Guest sees dates, never sources or notes.
    expect(body.unavailableRanges).toEqual([
      { startDate: "2026-09-12", endDate: "2026-09-16" },
    ]);
    expect(JSON.stringify(body)).not.toContain("Prywatna notatka");
    expect(JSON.stringify(body)).not.toContain("EXTERNAL_CALENDAR");
    expect(JSON.stringify(body)).not.toContain("AIRBNB");
  });

  it("does not serve availability for a Property that is not published", async () => {
    const draft = await app.inject({
      method: "POST",
      url: "/api/host/properties",
      cookies: hostA.cookies,
      payload: { title: "Szkic bez kalendarza", propertyType: "APARTMENT" },
    });
    const slug = draft.json().slug;

    const response = await app.inject({
      method: "GET",
      url: `/api/properties/${slug}/availability?from=2026-09-01&to=2026-10-01`,
    });
    expect(response.statusCode).toBe(404);
  });
});
