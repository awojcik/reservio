import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { availabilityBlocks, externalCalendars } from "../src/infrastructure/database/schema";
import { CalendarSyncService } from "../src/modules/calendars/calendar-sync.service";
import { ExternalCalendarsService } from "../src/modules/calendars/external-calendars.service";
import {
  DATABASE,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { startMockIcalServer, type MockFeed } from "./helpers/mock-ical-server";

let app: NestFastifyApplication;
let database: Database;
let sync: CalendarSyncService;
let calendars: ExternalCalendarsService;
let host: TestHost;
let property: { id: string; slug: string };
let feed: MockFeed;
const created: TestHost[] = [];

const feedWith = (events: string) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Mock//Rezervio//EN
${events}END:VCALENDAR`;

const event = (uid: string, start: string, end: string) => `BEGIN:VEVENT
UID:${uid}
DTSTART;VALUE=DATE:${start}
DTEND;VALUE=DATE:${end}
END:VEVENT
`;

/** Dates inside the sync horizon (today−30 … today+540) so nothing is clipped. */
function soon(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function iso(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

async function blocksFor(calendarId: string) {
  const rows = (await database.db.execute(
    (await import("drizzle-orm")).sql`
      SELECT external_event_uid AS uid,
             lower(date_range)::text AS start_date,
             upper(date_range)::text AS end_date
      FROM availability_blocks
      WHERE external_calendar_id = ${calendarId}
      ORDER BY lower(date_range)
    `,
  )) as unknown as { uid: string; start_date: string; end_date: string }[];
  return rows;
}

/** Each test starts from a clean calendar state for this Property. */
async function resetCalendars(): Promise<void> {
  await database.db
    .delete(availabilityBlocks)
    .where(eq(availabilityBlocks.propertyId, property.id));
  await database.db
    .delete(externalCalendars)
    .where(eq(externalCalendars.propertyId, property.id));
}

async function newCalendar(): Promise<string> {
  const calendar = await calendars.create(property.id, {
    provider: "AIRBNB",
    name: "Feed testowy",
    importUrl: feed.url,
  });
  return calendar.id;
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
  sync = app.get(CalendarSyncService);
  calendars = app.get(ExternalCalendarsService);

  host = await registerHost(app, "sync-owner");
  created.push(host);
  property = await createPublishedProperty(app, host, "Obiekt do synchronizacji");

  feed = await startMockIcalServer(feedWith(event("a@mock", soon(10), soon(14))));
});

beforeEach(async () => {
  await resetCalendars();
  feed.setStatus(200);
  feed.setRedirect(null);
});

afterAll(async () => {
  await feed.close();
  await cleanupHosts(database, created);
  await app.close();
});

describe("snapshot reconciliation", () => {
  it("inserts events on the first sync", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));

    const result = await sync.sync(calendarId);

    expect(result.inserted).toBe(1);
    expect(await blocksFor(calendarId)).toEqual([
      { uid: "a@mock", start_date: iso(soon(10)), end_date: iso(soon(14)) },
    ]);
  });

  it("leaves an unchanged event alone", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));

    await sync.sync(calendarId);
    const second = await sync.sync(calendarId);

    // A feed that has not moved must not churn rows — that is why events carry
    // a stable identity.
    expect(second).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
  });

  it("updates an event whose dates moved", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    feed.setBody(feedWith(event("a@mock", soon(11), soon(15))));
    const result = await sync.sync(calendarId);

    expect(result.updated).toBe(1);
    expect(await blocksFor(calendarId)).toEqual([
      { uid: "a@mock", start_date: iso(soon(11)), end_date: iso(soon(15)) },
    ]);
  });

  it("deletes an event the feed no longer lists", async () => {
    const calendarId = await newCalendar();
    feed.setBody(
      feedWith(event("a@mock", soon(10), soon(14)) + event("b@mock", soon(20), soon(22))),
    );
    await sync.sync(calendarId);

    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    const result = await sync.sync(calendarId);

    expect(result.deleted).toBe(1);
    expect((await blocksFor(calendarId)).map((row) => row.uid)).toEqual(["a@mock"]);
  });

  it("releases dates when an event becomes CANCELLED", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    feed.setBody(
      feedWith(`BEGIN:VEVENT
UID:a@mock
STATUS:CANCELLED
DTSTART;VALUE=DATE:${soon(10)}
DTEND;VALUE=DATE:${soon(14)}
END:VEVENT
`),
    );
    await sync.sync(calendarId);

    expect(await blocksFor(calendarId)).toEqual([]);
  });
});

describe("a failed sync preserves the previous snapshot", () => {
  it("keeps blocks when the feed returns an HTTP error", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    feed.setStatus(503);
    await expect(sync.sync(calendarId)).rejects.toMatchObject({ code: "HTTP_ERROR" });
    feed.setStatus(200);

    // The Property must not silently become bookable because someone else's
    // server had a bad minute (§33).
    expect(await blocksFor(calendarId)).toHaveLength(1);
  });

  it("keeps blocks when the feed cannot be parsed", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    feed.setBody("to zupełnie nie jest kalendarz");
    await expect(sync.sync(calendarId)).rejects.toMatchObject({ code: "PARSE_ERROR" });
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));

    expect(await blocksFor(calendarId)).toHaveLength(1);
  });

  it("records the failure on the calendar and counts it", async () => {
    const calendarId = await newCalendar();
    feed.setStatus(500);

    await expect(sync.sync(calendarId)).rejects.toBeTruthy();
    await expect(sync.sync(calendarId)).rejects.toBeTruthy();
    feed.setStatus(200);

    const [row] = await database.db
      .select()
      .from(externalCalendars)
      .where(eq(externalCalendars.id, calendarId));

    expect(row.consecutiveFailures).toBe(2);
    expect(row.lastErrorCode).toBe("HTTP_ERROR");
    expect(row.lastSyncFailedAt).not.toBeNull();
  });

  it("clears the failure counter after a success", async () => {
    const calendarId = await newCalendar();
    feed.setStatus(500);
    await expect(sync.sync(calendarId)).rejects.toBeTruthy();

    feed.setStatus(200);
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    const [row] = await database.db
      .select()
      .from(externalCalendars)
      .where(eq(externalCalendars.id, calendarId));

    expect(row.consecutiveFailures).toBe(0);
    expect(row.lastErrorCode).toBeNull();
    expect(row.lastSyncSucceededAt).not.toBeNull();
  });

  it("marks a redirect into a private address as a security rejection", async () => {
    const calendarId = await newCalendar();

    // The mock is itself on 127.0.0.1, which the development escape hatch
    // allows; a redirect to a blocked hostname must still be refused.
    feed.setRedirect("http://metadata.google.internal/latest/meta-data/");
    try {
      await expect(sync.sync(calendarId)).rejects.toMatchObject({
        code: "SECURITY_REJECTED",
        permanent: true,
      });
    } finally {
      // Restored even on failure, so one bad assertion does not cascade into
      // every test after it.
      feed.setRedirect(null);
    }
  });
});

describe("external blocks and their calendar", () => {
  it("disappear when the calendar is removed, leaving manual blocks alone", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/availability/block`,
      cookies: host.cookies,
      payload: { startDate: iso(soon(100)), endDate: iso(soon(102)) },
    });

    await calendars.remove(property.id, calendarId);

    expect(await blocksFor(calendarId)).toEqual([]);

    const remaining = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].sourceType).toBe("HOST_BLOCK");
  });

  it("disappear when the calendar is disabled", async () => {
    const calendarId = await newCalendar();
    feed.setBody(feedWith(event("a@mock", soon(10), soon(14))));
    await sync.sync(calendarId);

    await calendars.update(property.id, calendarId, { status: "DISABLED" });

    expect(await blocksFor(calendarId)).toEqual([]);
  });
});
