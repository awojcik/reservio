import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  bookingConversations,
  bookingMessages,
  bookings,
  notificationDeliveries,
  properties,
} from "../src/infrastructure/database/schema";
import { NotificationWorker } from "../src/modules/notifications/application/notification.worker";
import { NotificationsService } from "../src/modules/notifications/application/notifications.service";
import {
  DATABASE,
  TEST_PASSWORD,
  clearFinancials,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";

let app: NestFastifyApplication;
let database: Database;
let emails: FakeEmailProvider;
let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
let foreignProperty: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `msg-${Date.now()}-${(counter += 1)}`;

type Booking = { id: string; reference: string; token: string };

async function makeBooking(
  checkIn = "2029-09-12",
  checkOut = "2029-09-18",
  target = property.id,
  guest = { name: "Anna Nowak", email: "anna@example.com" },
): Promise<Booking> {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: { propertyId: target, checkIn, checkOut, adults: 2, guest },
  });

  expect(response.statusCode).toBe(201);
  const reference = response.json().reference as string;
  const token = response.cookies.find((c) => c.name === "rezervio_booking_access")!.value;

  const [row] = await database.db
    .select()
    .from(bookings)
    .where(eq(bookings.publicReference, reference));

  await database.db
    .update(bookings)
    .set({ status: "CONFIRMED", confirmedAt: new Date() })
    .where(eq(bookings.id, row.id));

  return { id: row.id, reference, token };
}

async function guestSend(booking: Booking, body: string, cookies?: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: `/api/bookings/${booking.reference}/messages`,
    cookies: cookies ?? { rezervio_booking_access: booking.token },
    payload: { body },
  });
}

async function guestRead(booking: Booking, query = "", cookies?: Record<string, string>) {
  return app.inject({
    method: "GET",
    url: `/api/bookings/${booking.reference}/messages${query}`,
    cookies: cookies ?? { rezervio_booking_access: booking.token },
  });
}

async function hostSend(booking: Booking, body: string, who = host) {
  return app.inject({
    method: "POST",
    url: `/api/host/bookings/${booking.id}/messages`,
    cookies: who.cookies,
    payload: { body },
  });
}

async function hostRead(booking: Booking, who = host) {
  return app.inject({
    method: "GET",
    url: `/api/host/bookings/${booking.id}/messages`,
    cookies: who.cookies,
  });
}

/** Runs the outbox → queue → send pipeline the way production does. */
async function flushNotifications(): Promise<void> {
  const worker = app.get(NotificationWorker);
  const service = app.get(NotificationsService);

  const claimed = await app.get(NotificationWorker)["outbox"].claimPending();
  for (const event of claimed) {
    const type = event.payload.notificationType;
    if (type) {
      await service.deliver(event.payload.bookingId, type as never, event.payload.refId ?? null);
    }
    await worker["outbox"].markProcessed(event.id);
  }
}

async function reset() {
  await database.db.delete(bookingMessages);
  await database.db.delete(bookingConversations);
  await clearFinancials(database);
  await database.db.delete(bookings);
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.delete(notificationDeliveries);
  emails.reset();
}

beforeAll(async () => {
  emails = new FakeEmailProvider();
  app = await createTestApp({ emailProvider: emails });
  database = app.get<Database>(DATABASE);

  host = await registerHost(app, "msg-owner");
  stranger = await registerHost(app, "msg-stranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "Baltic Loft");
  foreignProperty = await createPublishedProperty(app, stranger, "Obcy obiekt");

  await database.db
    .update(properties)
    .set({ bookingMode: "INSTANT_BOOK" })
    .where(eq(properties.id, property.id));
  await database.db
    .update(properties)
    .set({ bookingMode: "INSTANT_BOOK" })
    .where(eq(properties.id, foreignProperty.id));
});

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await reset();
  await cleanupHosts(database, created);
  await app.close();
});

describe("guest ↔ host conversation", () => {
  it("carries a message from the Guest to the Host", async () => {
    const booking = await makeBooking();

    const sent = await guestSend(booking, "Dzień dobry, o której mogę przyjechać?");
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      senderType: "GUEST",
      senderName: "Anna Nowak",
      body: "Dzień dobry, o której mogę przyjechać?",
    });

    const seenByHost = await hostRead(booking);
    expect(seenByHost.json().items).toHaveLength(1);
    expect(seenByHost.json().items[0]).toMatchObject({
      senderType: "GUEST",
      mine: false,
    });
  });

  it("carries a reply back to the Guest", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "Pytanie od gościa");

    const reply = await hostSend(booking, "Od 15:00, zapraszam.");
    expect(reply.statusCode).toBe(201);
    expect(reply.json().senderType).toBe("HOST");

    const seenByGuest = await guestRead(booking);
    const bodies = seenByGuest.json().items.map((m: { body: string }) => m.body);
    expect(bodies).toEqual(["Pytanie od gościa", "Od 15:00, zapraszam."]);
    expect(seenByGuest.json().items[1].mine).toBe(false);
  });

  it("keeps one conversation per Booking", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "pierwsza");
    await hostSend(booking, "druga");
    await guestSend(booking, "trzecia");

    const conversations = await database.db
      .select()
      .from(bookingConversations)
      .where(eq(bookingConversations.bookingId, booking.id));

    expect(conversations).toHaveLength(1);
  });

  it("works for a Guest with no account", async () => {
    const booking = await makeBooking();

    const sent = await guestSend(booking, "Piszę bez konta.");
    expect(sent.statusCode).toBe(201);

    const [row] = await database.db.select().from(bookingMessages);
    expect(row.senderUserId).toBeNull();
    expect(row.senderType).toBe("GUEST");
  });

  it("links the message to the account when the Guest has one", async () => {
    const account = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: `msg-guest-${Date.now()}@example.com`, password: TEST_PASSWORD },
    });
    const session = Object.fromEntries(
      account.cookies.map((c) => [c.name, c.value]),
    ) as Record<string, string>;

    const booking = await makeBooking();
    await guestSend(booking, "Z konta.", {
      ...session,
      rezervio_booking_access: booking.token,
    });

    const [row] = await database.db.select().from(bookingMessages);
    expect(row.senderUserId).not.toBeNull();
  });
});

describe("authorization", () => {
  it("refuses a Guest with no proof of access", async () => {
    const booking = await makeBooking();

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/bookings/${booking.reference}/messages`,
        })
      ).statusCode,
    ).toBe(401);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/bookings/${booking.reference}/messages`,
          payload: { body: "cześć" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("refuses a token belonging to a different Booking", async () => {
    const mine = await makeBooking("2029-09-12", "2029-09-18");
    const other = await makeBooking("2029-10-12", "2029-10-18");

    const response = await guestRead(mine, "", {
      rezervio_booking_access: other.token,
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses a Host who does not own the Booking", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "prywatna wiadomość");

    expect((await hostRead(booking, stranger)).statusCode).toBe(404);
    expect((await hostSend(booking, "wtrącam się", stranger)).statusCode).toBe(404);

    // And nothing was written.
    expect(await database.db.select().from(bookingMessages)).toHaveLength(1);
  });

  it("keeps two Hosts' conversations apart", async () => {
    const mine = await makeBooking("2029-09-12", "2029-09-18");
    const theirs = await makeBooking("2029-09-12", "2029-09-18", foreignProperty.id, {
      name: "Obcy Gość",
      email: "obcy@example.com",
    });

    await guestSend(mine, "moja wiadomość");
    await guestSend(theirs, "cudza wiadomość");

    const mineSeen = await hostRead(mine);
    const bodies = mineSeen.json().items.map((m: { body: string }) => m.body);
    expect(bodies).toEqual(["moja wiadomość"]);
  });
});

describe("message rules", () => {
  it("rejects an empty or blank message", async () => {
    const booking = await makeBooking();

    expect((await guestSend(booking, "")).statusCode).toBe(400);
    expect((await guestSend(booking, "    ")).statusCode).toBe(400);
  });

  it("rejects a message over the limit", async () => {
    const booking = await makeBooking();

    expect((await guestSend(booking, "a".repeat(4001))).statusCode).toBe(400);
    expect((await guestSend(booking, "a".repeat(4000))).statusCode).toBe(201);
  });

  it("trims what it stores", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "   z odstępami   ");

    const [row] = await database.db.select().from(bookingMessages);
    expect(row.body).toBe("z odstępami");
  });

  it("stores markup as text rather than interpreting it", async () => {
    const booking = await makeBooking();
    const payload = "<script>alert('xss')</script><b>pogrubione</b>";

    await guestSend(booking, payload);

    // Stored verbatim; nothing in the pipeline treats it as HTML.
    const [row] = await database.db.select().from(bookingMessages);
    expect(row.body).toBe(payload);
    expect((await guestRead(booking)).json().items[0].body).toBe(payload);
  });

  it("closes writing on a cancelled Booking", async () => {
    const booking = await makeBooking();
    await database.db
      .update(bookings)
      .set({ status: "CANCELLED" })
      .where(eq(bookings.id, booking.id));

    const response = await guestSend(booking, "jeszcze jedno");
    expect(response.statusCode).toBe(409);
    expect(response.json().message.code ?? response.json().code).toBe("CONVERSATION_CLOSED");
  });

  it("closes writing long after the Stay, but keeps the history readable", async () => {
    const booking = await makeBooking("2020-01-10", "2020-01-14");
    await database.db.insert(bookingConversations).values({ bookingId: booking.id });

    expect((await guestSend(booking, "spóźnione")).statusCode).toBe(409);
    expect((await guestRead(booking)).statusCode).toBe(200);
  });
});

describe("pagination", () => {
  it("returns the newest page first and walks backwards", async () => {
    const booking = await makeBooking();
    for (let index = 1; index <= 7; index += 1) {
      await guestSend(booking, `wiadomość ${index}`);
    }

    const first = await guestRead(booking, "?limit=3");
    expect(first.json().hasMore).toBe(true);
    expect(first.json().items.map((m: { body: string }) => m.body)).toEqual([
      "wiadomość 5",
      "wiadomość 6",
      "wiadomość 7",
    ]);

    const older = await guestRead(
      booking,
      `?limit=3&before=${encodeURIComponent(first.json().nextCursor)}`,
    );
    expect(older.json().items.map((m: { body: string }) => m.body)).toEqual([
      "wiadomość 2",
      "wiadomość 3",
      "wiadomość 4",
    ]);

    const oldest = await guestRead(
      booking,
      `?limit=3&before=${encodeURIComponent(older.json().nextCursor)}`,
    );
    expect(oldest.json().items.map((m: { body: string }) => m.body)).toEqual(["wiadomość 1"]);
    expect(oldest.json().hasMore).toBe(false);
    expect(oldest.json().nextCursor).toBeNull();
  });

  it("returns an empty page for a conversation nobody started", async () => {
    const booking = await makeBooking();

    expect((await guestRead(booking)).json()).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("rejects a nonsense cursor", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "cześć");

    expect((await guestRead(booking, "?before=wczoraj")).statusCode).toBe(400);
  });
});

describe("message notifications", () => {
  it("mails the Host once when the Guest writes", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "Pytanie o parking");

    await flushNotifications();

    const sent = emails.sent.filter((mail) => mail.subject.includes("od gościa"));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(host.email);
    // The body itself stays in Rezervio, where both sides are authenticated.
    expect(sent[0].text).not.toContain("Pytanie o parking");
  });

  it("mails the Guest once when the Host replies", async () => {
    const booking = await makeBooking();
    await hostSend(booking, "Zapraszam od 15:00");

    await flushNotifications();

    const sent = emails.sent.filter((mail) => mail.subject.includes("od gospodarza"));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("anna@example.com");
  });

  it("gives every message its own notification", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "pierwsza");
    await guestSend(booking, "druga");

    await flushNotifications();

    const deliveries = await database.db.select().from(notificationDeliveries);
    expect(deliveries).toHaveLength(2);
    // Keyed per message, not per Booking (milestone 09 §37).
    expect(new Set(deliveries.map((d) => d.dedupKey)).size).toBe(2);
    for (const delivery of deliveries) {
      expect(delivery.dedupKey).toMatch(/^booking-message:[0-9a-f-]{36}:host$/);
    }
  });

  it("does not send twice when the delivery is retried", async () => {
    const booking = await makeBooking();
    await guestSend(booking, "jedna wiadomość");

    await flushNotifications();
    const before = emails.sent.length;

    // Same message, delivered again — the dedup key is what stops it.
    const [message] = await database.db.select().from(bookingMessages);
    await app
      .get(NotificationsService)
      .deliver(booking.id, "BOOKING_MESSAGE_TO_HOST", message.id);

    expect(emails.sent.length).toBe(before);
  });

  it("keeps the message when the email fails", async () => {
    const booking = await makeBooking();
    emails.failPermanently();

    const sent = await guestSend(booking, "wiadomość mimo awarii poczty");
    expect(sent.statusCode).toBe(201);

    await flushNotifications();

    // The message survived; only the delivery is marked failed.
    expect(await database.db.select().from(bookingMessages)).toHaveLength(1);
    const [delivery] = await database.db.select().from(notificationDeliveries);
    expect(delivery.status).toBe("FAILED");

    emails.reset();
  });
});
