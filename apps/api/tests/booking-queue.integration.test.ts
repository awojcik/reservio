import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { HOLD_QUEUE, type BookingHoldJob } from "../src/infrastructure/queue/queue.module";
import {
  availabilityBlocks,
  bookingHolds,
  bookings,
  properties,
} from "../src/infrastructure/database/schema";
import { BookingHoldWorker } from "../src/modules/bookings/booking-hold.worker";
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
let queue: Queue<BookingHoldJob>;
let worker: BookingHoldWorker;
let host: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let keyCounter = 0;

async function instantBook() {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": `queue-${Date.now()}-${(keyCounter += 1)}` },
    payload: {
      propertyId: property.id,
      checkIn: "2026-12-10",
      checkOut: "2026-12-14",
      adults: 2,
      guest: { name: "Anna Nowak", email: "anna@example.com" },
    },
  });
  expect(response.statusCode).toBe(201);

  const [hold] = await database.db
    .select()
    .from(bookingHolds)
    .where(eq(bookingHolds.propertyId, property.id));
  return hold;
}

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
  queue = app.get(HOLD_QUEUE);
  worker = app.get(BookingHoldWorker);

  host = await registerHost(app, "hold-queue-owner");
  created.push(host);
  property = await createPublishedProperty(app, host, "Obiekt kolejki holdów");

  await database.db
    .update(properties)
    .set({ bookingMode: "INSTANT_BOOK" })
    .where(eq(properties.id, property.id));
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
  await database.db
    .delete(availabilityBlocks)
    .where(eq(availabilityBlocks.propertyId, property.id));
  await database.db.delete(bookingHolds).where(eq(bookingHolds.propertyId, property.id));
  await database.db.delete(bookings).where(eq(bookings.propertyId, property.id));
});

afterAll(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await database.db.delete(bookings).where(eq(bookings.propertyId, property.id));
  await cleanupHosts(database, created);
  await app.close();
});

describe("booking-hold-expire queue", () => {
  it("schedules a delayed job when a hold is created", async () => {
    const hold = await instantBook();

    const job = await queue.getJob(`booking-hold-expire-${hold.id}`);
    expect(job).toBeDefined();
    expect(job!.data.holdId).toBe(hold.id);
    // Delayed until the TTL runs out, not run immediately.
    expect(job!.opts.delay).toBeGreaterThan(0);
  });

  it("does not schedule a second job when the command is retried", async () => {
    const hold = await instantBook();
    await worker.scheduleExpiry(hold.id, hold.expiresAt);
    await worker.scheduleExpiry(hold.id, hold.expiresAt);

    const counts = await queue.getJobCounts("delayed", "waiting");
    expect((counts.delayed ?? 0) + (counts.waiting ?? 0)).toBe(1);
  });

  it("expires the hold when the job runs", async () => {
    const hold = await instantBook();

    // Bring the TTL forward and re-queue with no delay, rather than waiting
    // ten real minutes.
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));
    await queue.obliterate({ force: true });
    await worker.scheduleExpiry(hold.id, new Date(Date.now() - 1000));

    const running = worker.start();
    try {
      await waitFor(async () => {
        const [row] = await database.db
          .select()
          .from(bookingHolds)
          .where(eq(bookingHolds.id, hold.id));
        return row?.status === "EXPIRED";
      });
    } finally {
      await running.close();
    }

    const [booking] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, hold.bookingId));
    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));

    expect(booking.status).toBe("EXPIRED");
    expect(blocks).toHaveLength(0);
  });

  it("registers a periodic sweep scheduler", async () => {
    await worker.scheduleSweep();

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((entry) => entry.key)).toContain("booking-hold-sweep");
  });

  it("sweeps holds whose job was lost", async () => {
    const hold = await instantBook();

    // Simulates a flushed Redis: the row is due, but no job exists any more.
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));
    await queue.obliterate({ force: true });

    const { expired } = await worker.sweepExpired();
    expect(expired).toBeGreaterThanOrEqual(1);

    const [row] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.id, hold.id));
    expect(row.status).toBe("EXPIRED");
  });
});
