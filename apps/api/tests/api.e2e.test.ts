import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { applyTestEnv } from "./helpers/test-env";

/** Smoke tests: every public endpoint answers and keeps its response shape. */
let app: NestFastifyApplication;

beforeAll(async () => {
  // Before the module compiles: ConfigModule reads the environment once.
  applyTestEnv();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    // `configureApp` installs the raw-body-preserving JSON parser.
    bodyParser: false,
  });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("public endpoints", () => {
  it("GET /api/health reports liveness without touching a dependency", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", environment: expect.any(String) });
  });

  it("GET /api/ready reports every dependency", async () => {
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      database: { status: "up" },
      redis: { status: "up" },
    });
  });

  it("GET /api/search returns items and a total", async () => {
    const response = await app.inject({ method: "GET", url: "/api/search" });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");

    const [item] = body.items;
    expect(item).toMatchObject({
      id: expect.any(String),
      slug: expect.any(String),
      title: expect.any(String),
      city: expect.any(String),
      latitude: expect.any(Number),
      longitude: expect.any(Number),
      amenities: expect.any(Array),
      price: {
        nights: expect.any(Number),
        totalAmountMinor: expect.any(Number),
        currency: "PLN",
      },
    });
  });

  it("GET /api/properties/:slug returns the full Listing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/properties/baltic-loft-brzezno?checkIn=2026-09-12&checkOut=2026-09-16",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.slug).toBe("baltic-loft-brzezno");
    expect(body.images.length).toBeGreaterThan(0);
    expect(body.description.length).toBeGreaterThan(0);
    expect(body.price).toMatchObject({
      nights: 4,
      accommodationAmountMinor: 180_000,
      cleaningFeeAmountMinor: 12_000,
      totalAmountMinor: 192_000,
      savingAmountMinor: 18_000,
      currency: "PLN",
    });
  });

  it("GET /api/properties/:slug is 404 for an unknown Property", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/properties/nie-ma-takiego-obiektu",
    });

    expect(response.statusCode).toBe(404);
  });

  it("serves the OpenAPI document the client is generated from", async () => {
    const response = await app.inject({ method: "GET", url: "/api/openapi.json" });

    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/api/health", "/api/search", "/api/properties/{slug}"]),
    );
  });
});
