import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { DATABASE } from "../src/infrastructure/database/database.module";
import type { Database } from "../src/infrastructure/database/connection";
import { hosts, properties } from "../src/infrastructure/database/schema";
import type { SearchResponseDto } from "../src/modules/properties/dto/property.dto";

/**
 * Integration rather than unit tests: the whole point of this milestone is that
 * filtering, sorting and geo run in PostgreSQL, so asserting them anywhere else
 * would prove nothing. Requires the local database (`pnpm db:start && pnpm
 * db:migrate && pnpm db:seed`).
 */
const STAY = "checkIn=2026-09-12&checkOut=2026-09-16";
const DRAFT_SLUG = "test-draft-nie-publikowany";

let app: NestFastifyApplication;
let database: Database;

async function search(query: string): Promise<SearchResponseDto> {
  const response = await app.inject({ method: "GET", url: `/api/search?${query}` });
  expect(response.statusCode).toBe(200);
  return response.json() as SearchResponseDto;
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://rezervio:rezervio@localhost:5432/rezervio";

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    // `configureApp` installs the raw-body-preserving JSON parser.
    bodyParser: false,
  });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  database = app.get<Database>(DATABASE);

  // A non-published Property proves the public endpoints filter by status.
  const [host] = await database.db.select({ id: hosts.id }).from(hosts).limit(1);
  await database.db
    .insert(properties)
    .values({
      hostId: host.id,
      slug: DRAFT_SLUG,
      title: "Ukryty apartament testowy",
      description: "Nie powinien pojawić się w wynikach.",
      propertyType: "APARTMENT",
      status: "DRAFT",
      city: "Gdańsk",
      district: "Brzeźno",
      latitude: 54.4,
      longitude: 18.61,
      maxGuests: 4,
      bedrooms: 1,
      beds: 1,
      bathrooms: 1,
      rating: 10,
      reviewCount: 1,
      baseDailyRateAmountMinor: 100,
      cleaningFeeAmountMinor: 0,
      marketDailyRateAmountMinor: null,
      currency: "PLN",
    })
    .onConflictDoNothing({ target: properties.slug });
});

afterAll(async () => {
  await database.db.delete(properties).where(eq(properties.slug, DRAFT_SLUG));
  await app.close();
});

describe("GET /api/search", () => {
  it("returns only PUBLISHED Property", async () => {
    const result = await search(`${STAY}&destination=Gdansk&limit=200`);

    expect(result.total).toBeGreaterThan(0);
    expect(result.items.some((item) => item.slug === DRAFT_SLUG)).toBe(false);
  });

  it("matches the destination across diacritics and typos", async () => {
    const [exact, plain, typo] = await Promise.all([
      search(`${STAY}&destination=Gdańsk`),
      search(`${STAY}&destination=Gdansk`),
      search(`${STAY}&destination=gdans`),
    ]);

    expect(plain.total).toBe(exact.total);
    expect(typo.total).toBe(exact.total);
    expect(exact.items.every((item) => item.city === "Gdańsk")).toBe(true);
  });

  it("matches a district as well as a city", async () => {
    const result = await search(`${STAY}&destination=Brzezno`);

    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((item) => item.district === "Brzeźno")).toBe(true);
  });

  it("drops Property that cannot host every guest", async () => {
    const result = await search(`${STAY}&destination=Gdansk&adults=6&children=2`);

    expect(result.items.every((item) => item.maxGuests >= 8)).toBe(true);
  });

  it("applies the pool and parking shortcuts as amenity filters", async () => {
    const result = await search(`${STAY}&destination=Gdansk&pool=true&parking=true`);

    expect(result.total).toBeGreaterThan(0);
    expect(
      result.items.every(
        (item) => item.amenities.includes("POOL") && item.amenities.includes("PARKING"),
      ),
    ).toBe(true);
  });

  it("treats maxPrice as the total price of the stay", async () => {
    const maxPrice = 250_000;
    const result = await search(`${STAY}&destination=Gdansk&maxPrice=${maxPrice}`);

    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((item) => item.price.totalAmountMinor <= maxPrice)).toBe(
      true,
    );
    // Four nights: a per-night reading of the same number would let far more through.
    expect(result.items.every((item) => item.price.nights === 4)).toBe(true);
  });

  it("filters by minimum rating", async () => {
    const result = await search(`${STAY}&destination=Gdansk&minRating=9.5`);

    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((item) => item.rating >= 9.5)).toBe(true);
  });

  it("filters by the map viewport", async () => {
    const result = await search(
      `${STAY}&north=54.46&south=54.43&east=18.60&west=18.55`,
    );

    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((item) => item.latitude >= 54.43)).toBe(true);
    expect(result.items.every((item) => item.latitude <= 54.46)).toBe(true);
    expect(result.items.every((item) => item.city === "Sopot")).toBe(true);
  });

  it("rejects an incomplete viewport", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/search?north=54.46&south=54.43`,
    });

    expect(response.statusCode).toBe(400);
  });

  it("sorts by lowest total price", async () => {
    const result = await search(`${STAY}&destination=Gdansk&sort=LOWEST_PRICE`);
    const totals = result.items.map((item) => item.price.totalAmountMinor);

    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it("sorts by highest rating", async () => {
    const result = await search(`${STAY}&destination=Gdansk&sort=HIGHEST_RATING`);
    const ratings = result.items.map((item) => item.rating);

    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });

  it("puts Property without a beach distance last", async () => {
    const result = await search(`${STAY}&destination=Gdansk&sort=CLOSEST_TO_BEACH`);
    const firstUnknown = result.items.findIndex(
      (item) => item.distanceToBeachMeters === null,
    );

    if (firstUnknown !== -1) {
      expect(
        result.items
          .slice(firstUnknown)
          .every((item) => item.distanceToBeachMeters === null),
      ).toBe(true);
    }
  });

  it("sorts best value by the largest saving", async () => {
    const result = await search(`${STAY}&destination=Gdansk&sort=BEST_VALUE`);
    const savings = result.items.map((item) => item.price.savingAmountMinor ?? 0);

    expect(savings).toEqual([...savings].sort((a, b) => b - a));
  });

  it("returns an empty result set rather than an error", async () => {
    const result = await search(
      `${STAY}&destination=Gdansk&propertyType=STUDIO&minBedrooms=4`,
    );

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("rejects invalid input with 400", async () => {
    for (const query of [
      "adults=0",
      "minRating=11",
      "sort=RANDOM",
      "checkIn=2026-09-16&checkOut=2026-09-12",
      "propertyType=CASTLE",
    ]) {
      const response = await app.inject({ method: "GET", url: `/api/search?${query}` });
      expect(response.statusCode, query).toBe(400);
    }
  });
});
