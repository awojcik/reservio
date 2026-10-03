import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  availabilityBlocks,
  externalCalendars,
} from "../src/infrastructure/database/schema";
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
let stranger: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

/** Pulls the token out of the URL the API hands back exactly once. */
function tokenFrom(url: string): string {
  return url.split("/").pop()!.replace(/\.ics$/, "");
}

async function issueToken(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/host/properties/${property.id}/calendar-export`,
    cookies: host.cookies,
  });
  expect(response.statusCode).toBe(200);
  return tokenFrom(response.json().url);
}

async function addHostBlock(startDate: string, endDate: string, note?: string) {
  await app.inject({
    method: "POST",
    url: `/api/host/properties/${property.id}/availability/block`,
    cookies: host.cookies,
    payload: { startDate, endDate, ...(note ? { note } : {}) },
  });
}

async function addExternalBlock(startDate: string, endDate: string) {
  const [calendar] = await database.db
    .insert(externalCalendars)
    .values({
      propertyId: property.id,
      provider: "BOOKING",
      name: "Feed",
      importUrlEncrypted: "v1.placeholder",
    })
    .returning();

  await database.db.execute(sql`
    INSERT INTO availability_blocks
      (property_id, source_type, date_range, external_calendar_id, external_event_uid)
    VALUES (${property.id}, 'EXTERNAL_CALENDAR',
            daterange(${startDate}::date, ${endDate}::date, '[)'),
            ${calendar.id}, ${"uid-" + startDate})
  `);
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);

  host = await registerHost(app, "export-owner");
  stranger = await registerHost(app, "export-stranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "Obiekt do eksportu");
});

beforeEach(async () => {
  await database.db
    .delete(availabilityBlocks)
    .where(eq(availabilityBlocks.propertyId, property.id));
  await database.db
    .delete(externalCalendars)
    .where(eq(externalCalendars.propertyId, property.id));
});

afterAll(async () => {
  await cleanupHosts(database, created);
  await app.close();
});

describe("iCal export", () => {
  it("issues a token and serves the feed without a session", async () => {
    const token = await issueToken();

    const response = await app.inject({ method: "GET", url: `/api/calendar/ical/${token}.ics` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/calendar");
    expect(response.body).toContain("BEGIN:VCALENDAR");
    expect(response.body).toContain("END:VCALENDAR");
  });

  it("rejects an unknown token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/calendar/ical/zupelnie-wymyslony-token.ics",
    });
    expect(response.statusCode).toBe(404);
  });

  it("exports HOST_BLOCK with an exclusive DTEND", async () => {
    await addHostBlock("2026-09-12", "2026-09-16");
    const token = await issueToken();

    const body = (await app.inject({ method: "GET", url: `/api/calendar/ical/${token}.ics` }))
      .body;

    expect(body).toContain("DTSTART;VALUE=DATE:20260912");
    // Stored exclusive, exported exclusive — no ±1 anywhere in the pipeline.
    expect(body).toContain("DTEND;VALUE=DATE:20260916");
    expect(body).toContain("SUMMARY:Unavailable");
    expect(body).toMatch(/UID:availability-block-[0-9a-f-]{36}@rezervio/);
  });

  it("never exports EXTERNAL_CALENDAR blocks", async () => {
    await addHostBlock("2026-09-12", "2026-09-14");
    await addExternalBlock("2026-10-01", "2026-10-05");
    const token = await issueToken();

    const body = (await app.inject({ method: "GET", url: `/api/calendar/ical/${token}.ics` }))
      .body;

    // Re-exporting an imported block would feed it back to its own source and
    // the two calendars would block each other forever.
    expect(body).toContain("20260912");
    expect(body).not.toContain("20261001");
    expect((body.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });

  it("leaks no private data", async () => {
    await addHostBlock("2026-09-12", "2026-09-16", "Remont łazienki, ekipa Kowalski");
    const token = await issueToken();

    const body = (await app.inject({ method: "GET", url: `/api/calendar/ical/${token}.ics` }))
      .body;

    expect(body).not.toContain("Remont");
    expect(body).not.toContain("Kowalski");
    expect(body).not.toContain(property.slug);
  });

  it("invalidates the old token on regeneration", async () => {
    const first = await issueToken();

    const regenerated = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/calendar-export/regenerate`,
      cookies: host.cookies,
    });
    const second = tokenFrom(regenerated.json().url);

    expect(second).not.toBe(first);
    expect(
      (await app.inject({ method: "GET", url: `/api/calendar/ical/${first}.ics` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `/api/calendar/ical/${second}.ics` })).statusCode,
    ).toBe(200);
  });

  it("stops serving a revoked token", async () => {
    const token = await issueToken();

    await app.inject({
      method: "DELETE",
      url: `/api/host/properties/${property.id}/calendar-export`,
      cookies: host.cookies,
    });

    expect(
      (await app.inject({ method: "GET", url: `/api/calendar/ical/${token}.ics` })).statusCode,
    ).toBe(404);
  });

  it("stores only a hash of the token", async () => {
    const token = await issueToken();

    const [row] = (await database.db.execute(sql`
      SELECT token_hash FROM calendar_export_tokens
      WHERE property_id = ${property.id} AND revoked_at IS NULL
    `)) as unknown as { token_hash: string }[];

    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64);
  });

  it("keeps another Host from rotating the token", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/calendar-export/regenerate`,
      cookies: stranger.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it("reports status without ever handing the URL back again", async () => {
    await issueToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/calendar-export`,
      cookies: host.cookies,
    });

    expect(response.json().active).toBe(true);
    expect(JSON.stringify(response.json())).not.toContain("/calendar/ical/");
  });
});
