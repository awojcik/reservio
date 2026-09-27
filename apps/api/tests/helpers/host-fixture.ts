import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { inArray, sql } from "drizzle-orm";

import { AppModule } from "../../src/app.module";
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from "../../src/modules/notifications/infrastructure/email-provider";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from "../../src/modules/payments/domain/payment-provider";
import { HostawayInventoryProvider } from "../../src/modules/connectivity/infrastructure/hostaway.provider";
import type { InventoryProvider } from "../../src/modules/connectivity/domain/inventory-provider";
import { configureApp } from "../../src/bootstrap";
import { DATABASE } from "../../src/infrastructure/database/database.module";
import type { Database } from "../../src/infrastructure/database/connection";
import { applyTestEnv } from "./test-env";
import {
  adminActions,
  externalInventoryConnections,
  hosts,
  properties,
  propertyImages,
  users,
  type UserRole,
} from "../../src/infrastructure/database/schema";

export type TestHost = {
  email: string;
  userId: string;
  hostId: string;
  /** Ready to hand to `app.inject({ cookies })`. */
  cookies: Record<string, string>;
};

export const TEST_PASSWORD = "test-haslo-integracyjne";

export type TestAppOptions = {
  /** Swaps SMTP for a double, so no test ever needs a mail server. */
  emailProvider?: EmailProvider;
  /** Swaps the PSP for a double, so no test ever needs a live sandbox. */
  paymentProvider?: PaymentProvider;
  /**
   * Swaps the PMS for a double. Rezervio has no Hostaway account, so this is
   * how everything below the network boundary is exercised in full
   * (milestone 12 §33).
   */
  inventoryProvider?: InventoryProvider;
};

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<NestFastifyApplication> {
  // Database, Redis and a deterministic encryption key — see test-env.ts for
  // why the key is assigned unconditionally.
  applyTestEnv();
  // The rest below is assigned unconditionally for the same reason: the suite
  // asserts on the behaviour these control, so inheriting the developer's .env
  // would make the results depend on the machine.
  // The background worker would race the assertions; the queue test starts one
  // on its own terms.
  process.env.DISABLE_CALENDAR_WORKER = "true";
  process.env.DISABLE_BOOKING_WORKER = "true";
  process.env.DISABLE_NOTIFICATION_WORKER = "true";
  // Refunds and provider cancels are driven explicitly by the payment tests.
  process.env.DISABLE_PAYMENT_WORKER = "true";
  // Stay reminders and the completion job are driven explicitly by the tests.
  process.env.DISABLE_STAY_WORKER = "true";
  // Settlement release and transfer are driven explicitly by the tests.
  process.env.DISABLE_SETTLEMENT_WORKER = "true";
  // Provider syncs and outbound pushes are driven explicitly by the tests.
  process.env.DISABLE_EXTERNAL_WORKER = "true";
  // No waiting for a real clock: the release policy is exercised by moving
  // `release_at`, not by sleeping (milestone 10 §3).
  process.env.HOST_SETTLEMENT_RELEASE_DELAY_HOURS ??= "24";
  process.env.APP_BASE_URL = "http://localhost:3000";
  // Mock feeds are served from 127.0.0.1, which SSRF protection blocks by
  // design; the development escape hatch is what makes them reachable.
  process.env.ICAL_ALLOW_PRIVATE_HOSTS = "true";
  // A namespace of its own, so a dev server running against the same Redis
  // neither steals these jobs nor receives them. The rate-limit counters share
  // this prefix, so they are namespaced with everything else.
  process.env.BULLMQ_PREFIX = "rezervio-test";
  /*
   * Registration is the one limited endpoint keyed by address alone, and the
   * whole suite registers from 127.0.0.1. Every other bucket is keyed by the
   * Booking, the calendar or the account under test, so it isolates itself.
   * The login and admin-search limits are left at their production values —
   * the security tests assert on them (milestone 11 §44).
   */
  process.env.RATE_LIMIT_REGISTER_MAX ??= "10000";
  /*
   * Connecting an integration is keyed per operator, and the connectivity
   * suite reuses one Host across every case. The manual-sync bucket is left at
   * its production value — a test asserts on it (milestone 12 §24).
   */
  process.env.RATE_LIMIT_INTEGRATION_CONNECT_MAX ??= "10000";

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.emailProvider) {
    builder.overrideProvider(EMAIL_PROVIDER).useValue(options.emailProvider);
  }
  if (options.paymentProvider) {
    builder.overrideProvider(PAYMENT_PROVIDER).useValue(options.paymentProvider);
  }
  if (options.inventoryProvider) {
    builder.overrideProvider(HostawayInventoryProvider).useValue(options.inventoryProvider);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    // Same as production: `configureApp` installs a JSON parser that keeps the
    // raw bytes for webhook signature verification, so Nest must not install
    // its own on top (milestone 08 §17).
    { bodyParser: false },
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * Clears the financial tables that reference a Booking.
 *
 * They use `ON DELETE RESTRICT` on purpose — a Booking must not be able to
 * take a settlement record with it in production — so a test that deletes
 * Bookings has to clear these first.
 */
/**
 * Clears connectivity state.
 *
 * `availability_blocks` cascades from the reservation mappings, so those go
 * first — deleting a mapping frees the dates it was blocking, which is exactly
 * the production behaviour.
 */
export async function clearConnectivity(database: Database): Promise<void> {
  await database.db.execute(sql`DELETE FROM external_sync_attempts`);
  await database.db.execute(sql`DELETE FROM external_provider_events`);
  await database.db.execute(sql`DELETE FROM external_reservation_mappings`);
  await database.db.execute(sql`DELETE FROM external_property_mappings`);
  await database.db.execute(sql`DELETE FROM external_inventory_connections`);
}

export async function clearFinancials(database: Database): Promise<void> {
  await database.db.execute(sql`DELETE FROM host_transfer_reversals`);
  await database.db.execute(sql`DELETE FROM host_transfers`);
  await database.db.execute(sql`DELETE FROM booking_settlements`);
  await database.db.execute(sql`DELETE FROM host_payouts`);
  await database.db.execute(sql`DELETE FROM refunds`);
  await database.db.execute(sql`DELETE FROM payments`);
}

/** Registers a fresh Host and keeps its session cookie for later requests. */
export async function registerHost(
  app: NestFastifyApplication,
  label: string,
): Promise<TestHost> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  // The Host-specific endpoint: plain /register now creates a User only,
  // because a Host profile is optional (milestone 06 §31).
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register/host",
    payload: { displayName: `Test ${label}`, email, password: TEST_PASSWORD },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Rejestracja nie powiodła się: ${response.statusCode} ${response.body}`);
  }

  const body = response.json();
  const setCookie = response.cookies.find((cookie) => cookie.name === "rezervio_session");
  if (!setCookie) throw new Error("Rejestracja nie ustawiła cookie sesji");

  return {
    email,
    userId: body.user.id,
    hostId: body.host.id,
    cookies: { rezervio_session: setCookie.value },
  };
}

/**
 * Removes what the tests created, in FK order: Property cascades to its images
 * and amenity links, Host restricts on User, so both go before the User row.
 */
export async function cleanupHosts(
  database: Database,
  created: TestHost[],
): Promise<void> {
  if (created.length === 0) return;

  // Guest-only accounts have no Host row, so the host cleanup is skipped for
  // them rather than matching on an empty id.
  const hostIds = created.map((host) => host.hostId).filter(Boolean);
  const userIds = created.map((host) => host.userId);

  if (hostIds.length > 0) {
    // Connections cascade from the Host and take their mappings — and the
    // availability blocks those mappings produced — with them.
    await database.db
      .delete(externalInventoryConnections)
      .where(inArray(externalInventoryConnections.hostId, hostIds));
    await database.db.delete(properties).where(inArray(properties.hostId, hostIds));
    await database.db.delete(hosts).where(inArray(hosts.id, hostIds));
  }
  // `admin_actions` restricts on the User that performed them — on purpose, so
  // an audit row cannot disappear with the account it names.
  await database.db.delete(adminActions).where(inArray(adminActions.adminUserId, userIds));
  await database.db.delete(users).where(inArray(users.id, userIds));
}

/** A Property filled in far enough that only images are missing. */
export const COMPLETE_PROPERTY_PATCH = {
  description:
    "Przestronny apartament z widokiem na morze i dwiema sypialniami. Do plaży dziesięć minut spacerem, w pobliżu molo, restauracje i przystanek tramwajowy.",
  address: {
    addressLine1: "ul. Testowa 1",
    postalCode: "80-001",
    city: "Gdańsk",
    district: "Brzeźno",
    countryCode: "PL",
    timeZone: "Europe/Warsaw",
    latitude: 54.40312,
    longitude: 18.61402,
  },
  capacity: { maxGuests: 4, bedrooms: 2, beds: 3, bathrooms: 1 },
  pricing: {
    baseDailyRateAmountMinor: 45_000,
    cleaningFeeAmountMinor: 10_000,
    currency: "PLN",
  },
  amenities: ["WIFI", "PARKING"],
};

/**
 * Creates a Property owned by `host` and pushes it all the way to PUBLISHED,
 * so availability filtering can be observed through the public Search.
 */
export async function createPublishedProperty(
  app: NestFastifyApplication,
  host: TestHost,
  title: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/api/host/properties",
    cookies: host.cookies,
    payload: { title, propertyType: "APARTMENT" },
  });
  const id = created.json().id as string;

  await app.inject({
    method: "PATCH",
    url: `/api/host/properties/${id}`,
    cookies: host.cookies,
    payload: { ...COMPLETE_PROPERTY_PATCH, ...overrides },
  });

  const database = app.get<Database>(DATABASE);
  await database.db.insert(propertyImages).values(
    Array.from({ length: 3 }, (_, index) => ({
      propertyId: id,
      objectKey: `properties/${id}/${crypto.randomUUID()}.jpg`,
      position: index,
    })),
  );

  const published = await app.inject({
    method: "POST",
    url: `/api/host/properties/${id}/publish`,
    cookies: host.cookies,
  });

  if (published.statusCode !== 200) {
    throw new Error(`Publikacja nie powiodła się: ${published.statusCode} ${published.body}`);
  }

  return { id, slug: published.json().slug as string };
}

/** Registers a plain User with no Host profile. */
export async function registerGuest(
  app: NestFastifyApplication,
  label: string,
  overrides: Record<string, unknown> = {},
): Promise<TestHost> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: TEST_PASSWORD, firstName: "Test", ...overrides },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Rejestracja nie powiodła się: ${response.statusCode} ${response.body}`);
  }

  const body = response.json();
  const setCookie = response.cookies.find((cookie) => cookie.name === "rezervio_session");
  if (!setCookie) throw new Error("Rejestracja nie ustawiła cookie sesji");

  return {
    email: body.user.email,
    userId: body.user.id,
    // No Host profile: this account exists purely as a Guest.
    hostId: "",
    cookies: { rezervio_session: setCookie.value },
  };
}

/**
 * Promotes an account to staff.
 *
 * Straight into the column, the way the CLI does it: there is deliberately no
 * endpoint that grants a role, so a test cannot go through one either
 * (milestone 11 §3).
 */
export async function grantRole(
  database: Database,
  userId: string,
  role: UserRole = "ADMIN",
): Promise<void> {
  await database.db
    .update(users)
    .set({ roles: [role] })
    .where(inArray(users.id, [userId]));
}

/** Users without a Host profile need a different cleanup order. */
export async function cleanupUsers(
  database: Database,
  users_: { userId: string }[],
): Promise<void> {
  if (users_.length === 0) return;
  const ids = users_.map((user) => user.userId);
  await database.db.delete(adminActions).where(inArray(adminActions.adminUserId, ids));
  await database.db.delete(users).where(inArray(users.id, ids));
}

export { DATABASE };
