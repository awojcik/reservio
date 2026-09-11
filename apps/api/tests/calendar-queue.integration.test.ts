import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { SYNC_QUEUE, type CalendarSyncJob } from "../src/infrastructure/queue/queue.module";
import { availabilityBlocks, externalCalendars } from "../src/infrastructure/database/schema";
import { CalendarSyncWorker } from "../src/modules/calendars/calendar-sync.worker";
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
let queue: Queue<CalendarSyncJob>;
let worker: CalendarSyncWorker;
let calendars: ExternalCalendarsService;
let host: TestHost;
let property: { id: string; slug: string };
let feed: MockFeed;
const created: TestHost[] = [];

function soon(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
}

const FEED = () => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Mock//Rezervio//EN
BEGIN:VEVENT
UID:queued@mock
DTSTART;VALUE=DATE:${soon(5)}
DTEND;VALUE=DATE:${soon(8)}
END:VEVENT
END:VCALENDAR`;

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Warunek nie został spełniony w oczekiwanym czasie.");
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
  queue = app.get(SYNC_QUEUE);
  worker = app.get(CalendarSyncWorker);
  calendars = app.get(ExternalCalendarsService);

  host = await registerHost(app, "queue-owner");
  created.push(host);
  property = await createPublishedProperty(app, host, "Obiekt kolejkowy");

  feed = await startMockIcalServer(FEED());
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
  await database.db
    .delete(availabilityBlocks)
    .where(eq(availabilityBlocks.propertyId, property.id));
  await database.db
    .delete(externalCalendars)
    .where(eq(externalCalendars.propertyId, property.id));
  feed.setStatus(200);
  feed.setBody(FEED());
});

afterAll(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await feed.close();
  await cleanupHosts(database, created);
  await app.close();
});

async function newCalendar(): Promise<string> {
  const calendar = await calendars.create(property.id, {
    provider: "PMS",
    name: "Feed kolejkowy",
    importUrl: feed.url,
  });
  return calendar.id;
}

describe("calendar-sync queue", () => {
  it("enqueues a job when the Host asks to sync now", async () => {
    const calendarId = await newCalendar();

    const response = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/external-calendars/${calendarId}/sync`,
      cookies: host.cookies,
    });

    // Accepted, not done: the feed is never fetched on the request thread.
    expect(response.statusCode).toBe(202);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("deduplicates repeated Sync now clicks", async () => {
    const calendarId = await newCalendar();

    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: "POST",
        url: `/api/host/properties/${property.id}/external-calendars/${calendarId}/sync`,
        cookies: host.cookies,
      });
    }

    // One jobId per calendar, so an impatient Host produces one job.
    expect(await queue.getWaitingCount()).toBe(1);
  });

  /**
   * The dedup covers work still in flight — not work that already finished.
   *
   * BullMQ keeps completed and failed jobs, and treats `add` with a known id
   * as a no-op, so a naive stable job id would make the *first* sync of a
   * calendar its last: every later "Sync now", from the Host panel or from
   * admin support, would silently do nothing (milestone 11 §10).
   */
  it("syncs again after the previous job finished", async () => {
    const calendarId = await newCalendar();
    await worker.enqueue(calendarId, true);

    const running = worker.start();
    try {
      await waitFor(async () => {
        const [row] = await database.db
          .select()
          .from(externalCalendars)
          .where(eq(externalCalendars.id, calendarId));
        return row.lastSyncSucceededAt !== null;
      });
    } finally {
      await running.close();
    }

    // The job is completed and its id is taken; asking again must still work.
    await worker.enqueue(calendarId, true);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("processes a queued job and records the result", async () => {
    const calendarId = await newCalendar();
    await worker.enqueue(calendarId, true);

    const running = worker.start();
    try {
      await waitFor(async () => {
        const [row] = await database.db
          .select()
          .from(externalCalendars)
          .where(eq(externalCalendars.id, calendarId));
        return row?.lastSyncSucceededAt !== null;
      });
    } finally {
      await running.close();
    }

    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.externalCalendarId, calendarId));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].sourceType).toBe("EXTERNAL_CALENDAR");
  });

  it("does not retry a permanent failure", async () => {
    const calendarId = await newCalendar();
    feed.setBody("to nie jest kalendarz");
    await worker.enqueue(calendarId, true);

    const running = worker.start();
    try {
      await waitFor(async () => (await queue.getFailedCount()) === 1);
      const [job] = await queue.getFailed();

      // A feed that cannot be parsed will not parse on the fifth attempt
      // either; retrying it just hammers someone else's server.
      expect(job.attemptsMade).toBe(1);
      expect(job.failedReason).toContain("PARSE_ERROR");
    } finally {
      await running.close();
    }
  });

  it("retries a temporary failure", async () => {
    const calendarId = await newCalendar();
    feed.setStatus(503);
    await worker.enqueue(calendarId, true);

    const running = worker.start();
    try {
      // Fetched by its known id rather than scanned out of a state list: the
      // job moves between states while the test watches, which makes any
      // list-based lookup a race.
      await waitFor(async () => {
        const job = await queue.getJob(`sync-${calendarId}`);
        return (job?.attemptsMade ?? 0) >= 1;
      });

      const job = await queue.getJob(`sync-${calendarId}`);

      // A 503 is worth another attempt, so the job is retried with a backoff
      // rather than abandoned after the first try.
      expect(job).toBeDefined();
      expect(job!.attemptsMade).toBeGreaterThanOrEqual(1);
      expect(job!.opts.attempts).toBe(5);
      expect(await job!.isFailed()).toBe(false);
    } finally {
      await running.close();
    }
  });

  it("sweeps only ACTIVE calendars that are due", async () => {
    const activeId = await newCalendar();
    const disabledId = await newCalendar();
    await calendars.update(property.id, disabledId, { status: "DISABLED" });

    await queue.obliterate({ force: true });
    await worker.enqueueDueCalendars();

    /*
     * Scoped to the two calendars this test made. The sweep is deliberately
     * global — it looks at every Host's feeds — so asserting on the total
     * would only be testing that the developer's database is empty.
     */
    const queued = (await queue.getWaiting()).map((job) => job.data.externalCalendarId);

    expect(queued).toContain(activeId);
    expect(queued).not.toContain(disabledId);
  });
});
