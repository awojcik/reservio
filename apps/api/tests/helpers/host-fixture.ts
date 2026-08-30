import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";

import { AppModule } from "../../src/app.module";
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from "../../src/modules/notifications/infrastructure/email-provider";
import { configureApp } from "../../src/bootstrap";
import { DATABASE } from "../../src/infrastructure/database/database.module";
import type { Database } from "../../src/infrastructure/database/connection";
import {
  hosts,
  properties,
  propertyImages,
  users,
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
};

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<NestFastifyApplication> {
  process.env.DATABASE_URL ??= "postgresql://rezervio:rezervio@localhost:5432/rezervio";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  // These three are assigned unconditionally: the suite asserts on the
  // behaviour they control, so inheriting whatever sits in the developer's
  // .env would make the results depend on the machine.
  //
  // A deterministic encryption key.
  process.env.ICAL_URL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  // The background worker would race the assertions; the queue test starts one
  // on its own terms.
  process.env.DISABLE_CALENDAR_WORKER = "true";
  process.env.DISABLE_BOOKING_WORKER = "true";
  process.env.DISABLE_NOTIFICATION_WORKER = "true";
  process.env.APP_BASE_URL = "http://localhost:3000";
  // Mock feeds are served from 127.0.0.1, which SSRF protection blocks by
  // design; the development escape hatch is what makes them reachable.
  process.env.ICAL_ALLOW_PRIVATE_HOSTS = "true";
  // A namespace of its own, so a dev server running against the same Redis
  // neither steals these jobs nor receives them.
  process.env.BULLMQ_PREFIX = "rezervio-test";

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.emailProvider) {
    builder.overrideProvider(EMAIL_PROVIDER).useValue(options.emailProvider);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
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
    await database.db.delete(properties).where(inArray(properties.hostId, hostIds));
    await database.db.delete(hosts).where(inArray(hosts.id, hostIds));
  }
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

/** Users without a Host profile need a different cleanup order. */
export async function cleanupUsers(
  database: Database,
  users_: { userId: string }[],
): Promise<void> {
  if (users_.length === 0) return;
  await database.db
    .delete(users)
    .where(inArray(users.id, users_.map((user) => user.userId)));
}

export { DATABASE };
