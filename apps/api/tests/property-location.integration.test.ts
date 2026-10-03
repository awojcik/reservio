import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { properties } from "../src/infrastructure/database/schema";
import { DEMO_PROPERTIES } from "../src/infrastructure/database/seed/demo-properties";
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
let host: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

async function patchAddress(address: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/api/host/properties/${property.id}`,
    cookies: host.cookies,
    payload: { address },
  });
}

async function storedPoint() {
  const [row] = await database.db
    .select({ latitude: properties.latitude, longitude: properties.longitude })
    .from(properties)
    .where(eq(properties.id, property.id));
  return row;
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);

  host = await registerHost(app, "locationhost");
  created.push(host);
  property = await createPublishedProperty(app, host, "Location Loft");
});

afterAll(async () => {
  await cleanupHosts(database, created);
  await app.close();
});

/**
 * `Property.latitude` / `Property.longitude` are the canonical source for every
 * map in Rezervio. What can be written into them is therefore worth guarding
 * at the boundary, not just in the form (§7).
 */
describe("storing a Property's location", () => {
  /**
   * A dragged marker sends six decimals — roughly ten centimetres. The columns
   * are `real`, which holds about seven significant digits, so the last decimal
   * can shift by a unit on the way in. That is a metre at worst and irrelevant
   * to a Listing; what matters is that the corrected point is what comes back,
   * not the one the geocoder proposed.
   */
  it("stores a corrected point", async () => {
    const response = await patchAddress({ latitude: 54.426395, longitude: 18.592277 });

    expect(response.statusCode).toBe(200);
    expect(response.json().address.latitude).toBeCloseTo(54.426395, 5);
    expect(response.json().address.longitude).toBeCloseTo(18.592277, 5);

    const stored = await storedPoint();
    expect(stored.latitude).toBeCloseTo(54.426395, 5);
    expect(stored.longitude).toBeCloseTo(18.592277, 5);
  });

  /** Half a location would pass the column checks and be unmappable. */
  it("refuses one coordinate without the other", async () => {
    const latOnly = await patchAddress({ latitude: 54.5 });
    expect(latOnly.statusCode).toBe(400);
    expect(latOnly.json().code).toBe("INCOMPLETE_COORDINATES");

    const lonOnly = await patchAddress({ longitude: 18.5 });
    expect(lonOnly.statusCode).toBe(400);
    expect(lonOnly.json().code).toBe("INCOMPLETE_COORDINATES");
  });

  it("refuses Null Island", async () => {
    const response = await patchAddress({ latitude: 0, longitude: 0 });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_COORDINATES");
  });

  it("refuses coordinates outside the world", async () => {
    for (const bad of [
      { latitude: 91, longitude: 18.5 },
      { latitude: 54.4, longitude: 181 },
    ]) {
      expect((await patchAddress(bad)).statusCode).toBe(400);
    }
  });

  /** A rejected write must not have moved anything. */
  it("leaves the previous point untouched when a write is refused", async () => {
    await patchAddress({ latitude: 54.35, longitude: 18.65 });
    await patchAddress({ latitude: 0, longitude: 0 });

    const stored = await storedPoint();
    expect(stored.latitude).toBeCloseTo(54.35, 5);
    expect(stored.longitude).toBeCloseTo(18.65, 5);
  });

  /** Editing the street must not disturb a point the Host already confirmed. */
  it("keeps the point when only the address text changes", async () => {
    await patchAddress({ latitude: 54.4079, longitude: 18.6391 });
    const response = await patchAddress({ addressLine1: "ul. Zdrojowa 4" });

    expect(response.statusCode).toBe(200);
    const stored = await storedPoint();
    expect(stored.latitude).toBeCloseTo(54.4079, 4);
    expect(stored.longitude).toBeCloseTo(18.6391, 4);
  });

  /**
   * "PO" is what "Polska" becomes in a two-character field, and it used to
   * store without complaint. Nothing downstream could recover from it: the
   * geocoder filters by country, so every lookup for that Property came back
   * empty and the Host was told their address did not exist.
   */
  it("refuses a country code that is not a country", async () => {
    for (const countryCode of ["PO", "POL", "XX", ""]) {
      expect((await patchAddress({ countryCode })).statusCode).toBe(400);
    }
  });

  it("accepts a real country code, in any case", async () => {
    expect((await patchAddress({ countryCode: "pl" })).statusCode).toBe(200);

    const [row] = await database.db
      .select({ countryCode: properties.countryCode })
      .from(properties)
      .where(eq(properties.id, property.id));
    expect(row.countryCode).toBe("PL");
  });
});

/**
 * The geocoding endpoint refuses the same bad country code the editor now
 * cannot produce. The rejection happens in validation, so no request reaches
 * the shared provider — an invalid country is our mistake to report, not
 * OpenStreetMap's to answer.
 */
describe("asking the geocoder for an address", () => {
  async function geocode(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/api/host/geocode",
      cookies: host.cookies,
      payload,
    });
  }

  it("refuses a country code that is not a country", async () => {
    const response = await geocode({ city: "Warszawa", countryCode: "PO" });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBeDefined();
  });
});

/**
 * The demo catalogue.
 *
 * Its coordinates are the geocoder's own answer for the street each Property
 * declares — captured once and pinned so seeding stays offline. These checks
 * are what stops somebody hand-editing a number back into the file (§6).
 */
describe("seeded catalogue", () => {
  it("gives every demo Property a real street address", () => {
    for (const demo of DEMO_PROPERTIES) {
      expect(demo.addressLine1.trim().length, demo.slug).toBeGreaterThan(3);
      expect(demo.postalCode, demo.slug).toMatch(/^\d{2}-\d{3}$/);
    }
  });

  it("has no duplicate points — nothing was copied from a neighbour", () => {
    const seen = new Set(
      DEMO_PROPERTIES.map((demo) => `${demo.latitude},${demo.longitude}`),
    );
    expect(seen.size).toBe(DEMO_PROPERTIES.length);
  });

  /**
   * Every demo Property sits within a few kilometres of the city it claims.
   * A city-centre fallback or a random offset would show up here immediately.
   */
  it("places every Property in the city it declares", () => {
    const CITIES: Record<string, [number, number]> = {
      Gdańsk: [54.372, 18.638],
      Sopot: [54.442, 18.56],
      Kraków: [50.062, 19.937],
      Zakopane: [49.299, 19.949],
    };

    for (const demo of DEMO_PROPERTIES) {
      const centre = CITIES[demo.city];
      expect(centre, `${demo.slug}: unknown city ${demo.city}`).toBeDefined();

      // Rough degrees-to-kilometres at this latitude; precision is not the point.
      const dLat = (demo.latitude - centre[0]) * 111;
      const dLon = (demo.longitude - centre[1]) * 111 * Math.cos((centre[0] * Math.PI) / 180);
      const km = Math.hypot(dLat, dLon);

      expect(km, `${demo.slug} is ${km.toFixed(1)} km from ${demo.city}`).toBeLessThan(12);
    }
  });

  it("is what the search API actually returns", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/search?destination=Gdańsk&limit=50",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as {
      slug: string;
      latitude: number;
      longitude: number;
    }[];
    expect(items.length).toBeGreaterThan(0);

    const bySlug = new Map(DEMO_PROPERTIES.map((demo) => [demo.slug, demo]));
    for (const item of items) {
      const demo = bySlug.get(item.slug);
      if (!demo) continue;

      // The marker the search map pins is the catalogue's own number, to the
      // precision a `real` column can hold.
      expect(item.latitude, item.slug).toBeCloseTo(demo.latitude, 4);
      expect(item.longitude, item.slug).toBeCloseTo(demo.longitude, 4);
    }
  });

  /** The detail page must show the same point the search map pinned. */
  it("serves the same point on the Property detail as in search", async () => {
    const search = await app.inject({
      method: "GET",
      url: "/api/search?destination=Gdańsk&limit=1",
    });
    const first = search.json().items[0] as {
      slug: string;
      latitude: number;
      longitude: number;
    };

    const detail = await app.inject({ method: "GET", url: `/api/properties/${first.slug}` });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().latitude).toBe(first.latitude);
    expect(detail.json().longitude).toBe(first.longitude);
  });

  it("never serves a Property without a usable point", async () => {
    const [row] = (await database.db.execute(sql`
      SELECT count(*)::int AS total FROM properties
      WHERE status = 'PUBLISHED'
        AND (latitude IS NULL OR longitude IS NULL
             OR (abs(latitude) < 1e-6 AND abs(longitude) < 1e-6))
    `)) as unknown as { total: number }[];

    expect(row.total).toBe(0);
  });
});
