import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { ConnectionsService } from "../src/modules/connectivity/application/connections.service";
import { MappingsService } from "../src/modules/connectivity/application/mappings.service";
import {
  DATABASE,
  cleanupHosts,
  clearConnectivity,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";
import { FakePaymentProvider } from "./helpers/fake-payment-provider";

const API_KEY = "channex-inbound-key-for-tests";
const HOTEL_CODE = "REZERVIO-HOTEL-1";

let app: NestFastifyApplication;
let database: Database;
let connections: ConnectionsService;
let mappings: MappingsService;

let host: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];
let connectionId: string;

async function blockCount(): Promise<number> {
  const [row] = (await database.db.execute(sql`
    SELECT count(*)::int AS total
    FROM availability_blocks
    WHERE property_id = ${property.id} AND source_type = 'EXTERNAL_PROVIDER'
  `)) as unknown as { total: number }[];

  return row?.total ?? 0;
}

function changes(overrides: {
  requestId: string;
  availability?: number;
  stopSell?: boolean;
  from?: string;
  to?: string;
}) {
  const entries: unknown[] = [];

  if (overrides.availability !== undefined) {
    entries.push({
      type: "availability_changes",
      attributes: {
        room_type_id: property.id,
        rate_plan_id: `${property.id}:standard`,
        date_from: overrides.from ?? "2034-01-10",
        date_to: overrides.to ?? "2034-01-13",
        availability: overrides.availability,
      },
    });
  }

  if (overrides.stopSell !== undefined) {
    entries.push({
      type: "restriction_changes",
      attributes: {
        room_type_id: property.id,
        rate_plan_id: `${property.id}:standard`,
        date_from: overrides.from ?? "2034-02-10",
        date_to: overrides.to ?? "2034-02-13",
        stop_sell: overrides.stopSell,
      },
    });
  }

  return {
    data: [
      {
        type: "changes_notification",
        attributes: {
          request_id: overrides.requestId,
          hotel_code: HOTEL_CODE,
          changes: entries,
        },
      },
    ],
  };
}

beforeAll(async () => {
  /*
   * A key, so the endpoints can be exercised at all. In a deployment without
   * Channex partner access this variable is unset and every route answers
   * `503 PARTNER_ACCESS_REQUIRED` — which is its own test below.
   */
  process.env.CHANNEX_INBOUND_API_KEY = API_KEY;

  app = await createTestApp({
    emailProvider: new FakeEmailProvider(),
    paymentProvider: new FakePaymentProvider(),
  });

  database = app.get<Database>(DATABASE);
  connections = app.get(ConnectionsService);
  mappings = app.get(MappingsService);

  host = await registerHost(app, "channexhost");
  created.push(host);
  property = await createPublishedProperty(app, host, "Channel Loft", {
    bookingMode: "INSTANT_BOOK",
  });
});

afterAll(async () => {
  delete process.env.CHANNEX_INBOUND_API_KEY;
  await clearConnectivity(database);
  await database.db.execute(sql`DELETE FROM availability_blocks`);
  await cleanupHosts(database, created);
  await app.close();
});

beforeEach(async () => {
  await clearConnectivity(database);
  await database.db.execute(sql`DELETE FROM availability_blocks`);

  const connection = await connections.upsert({
    hostId: host.hostId,
    provider: "CHANNEX",
    externalAccountId: HOTEL_CODE,
    status: "CONNECTED",
  });
  connectionId = connection.id;

  await mappings.create({
    connectionId,
    hostId: host.hostId,
    propertyId: property.id,
    externalPropertyId: HOTEL_CODE,
    externalPropertyName: "Channel Loft",
  });
});

/**
 * The Channex side of the relationship.
 *
 * Rezervio is the **channel** here, so the integration is mostly a small
 * server that Channex calls — `test_connection`, `mapping_details`, `changes`,
 * authenticated by an `api-key` header. All three paths and the header come
 * from Channex's published Open Channel API; none is invented
 * (milestone 12 §17, §20, §48).
 *
 * These endpoints exist and are exercised, but they are **not** a working
 * Channex integration: that needs a staging account, a registered Open Channel
 * and a passed certification, none of which this deployment has
 * (milestone 12 §18).
 */
describe("Channex channel endpoints", () => {
  it("rejects a call without the api-key header", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/channels/channex/test_connection?hotel_code=${HOTEL_CODE}`,
    });
    expect(anonymous.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "GET",
      url: `/api/channels/channex/test_connection?hotel_code=${HOTEL_CODE}`,
      headers: { "api-key": "not-the-key" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("answers test_connection in the documented shape", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/channels/channex/test_connection?hotel_code=${HOTEL_CODE}`,
      headers: { "api-key": API_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
  });

  /**
   * One room type, one rate plan.
   *
   * Channex's model is hotel-shaped; Rezervio's is one Property = one
   * independently bookable unit, with no room types and no allotment.
   * Presenting anything richer would describe inventory that does not exist.
   */
  it("publishes one room type and one read-only rate plan per Property", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/channels/channex/mapping_details?hotel_code=${HOTEL_CODE}`,
      headers: { "api-key": API_KEY },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.data.type).toBe("mapping_details");
    expect(body.data.attributes.room_types).toHaveLength(1);

    const roomType = body.data.attributes.room_types[0];
    expect(roomType).toMatchObject({ id: property.id, title: "Channel Loft" });
    expect(roomType.rate_plans).toHaveLength(1);
    expect(roomType.rate_plans[0]).toMatchObject({
      sell_mode: "per_room",
      currency: "PLN",
      // Pricing is the Host's, set in Rezervio. A channel must not rewrite it.
      read_only: true,
    });
  });

  it("blocks the calendar when the channel says zero available", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: changes({ requestId: "req-1", availability: 0 }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, unique_id: "req-1" });
    expect(await blockCount()).toBe(1);

    // `date_to` is inclusive in the contract and Rezervio's ranges are
    // half-open, so the block runs one day past the stated end.
    const [block] = (await database.db.execute(sql`
      SELECT lower(date_range)::text AS start_date, upper(date_range)::text AS end_date
      FROM availability_blocks WHERE property_id = ${property.id}
    `)) as unknown as { start_date: string; end_date: string }[];

    expect(block).toEqual({ start_date: "2034-01-10", end_date: "2034-01-14" });
  });

  it("blocks on stop_sell and frees the dates when it is lifted", async () => {
    await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: changes({ requestId: "req-stop", stopSell: true }),
    });
    expect(await blockCount()).toBe(1);

    await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: changes({ requestId: "req-open", stopSell: false }),
    });
    expect(await blockCount()).toBe(0);
  });

  /** Providers replay. The `request_id` is what makes a replay free. */
  it("treats a replayed request_id as a duplicate", async () => {
    const payload = changes({ requestId: "req-dup", availability: 0 });

    const first = await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload,
    });

    expect(first.json()).toEqual({ success: true, unique_id: "req-dup" });
    expect(replay.json()).toEqual({ success: true, unique_id: "req-dup" });
    expect(await blockCount()).toBe(1);
  });

  it("applies the same window twice as one block", async () => {
    await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: changes({ requestId: "req-a", availability: 0 }),
    });
    await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: changes({ requestId: "req-b", availability: 0 }),
    });

    expect(await blockCount()).toBe(1);
  });

  it("ignores a hotel code nobody has mapped", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: {
        data: [
          {
            type: "changes_notification",
            attributes: {
              request_id: "req-unknown",
              hotel_code: "SOMEBODY-ELSE",
              changes: [],
            },
          },
        ],
      },
    });

    // Acknowledged rather than errored: making Channex retry forever helps
    // nobody, and there is nothing here to apply.
    expect(response.statusCode).toBe(200);
    expect(await blockCount()).toBe(0);
  });

  it("acknowledges a payload it cannot read instead of failing forever", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/channels/channex/changes",
      headers: { "api-key": API_KEY },
      payload: { data: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
  });
});

/**
 * The gate.
 *
 * Without partner access there is no api-key to compare against, and every
 * endpoint says so — clearly, and with a code the UI can act on
 * (milestone 12 §21, §47).
 */
describe("Channex partner access gate", () => {
  it("answers PARTNER_ACCESS_REQUIRED when no channel key is configured", async () => {
    const key = process.env.CHANNEX_INBOUND_API_KEY;
    delete process.env.CHANNEX_INBOUND_API_KEY;

    try {
      const routes = [
        `/api/channels/channex/test_connection?hotel_code=${HOTEL_CODE}`,
        `/api/channels/channex/mapping_details?hotel_code=${HOTEL_CODE}`,
      ];

      for (const url of routes) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: { "api-key": API_KEY },
        });

        expect(response.statusCode).toBe(503);
        expect(response.json().code).toBe("PARTNER_ACCESS_REQUIRED");
      }

      const changesResponse = await app.inject({
        method: "POST",
        url: "/api/channels/channex/changes",
        headers: { "api-key": API_KEY },
        payload: changes({ requestId: "req-gate", availability: 0 }),
      });

      expect(changesResponse.statusCode).toBe(503);
      expect(changesResponse.json().code).toBe("PARTNER_ACCESS_REQUIRED");
    } finally {
      process.env.CHANNEX_INBOUND_API_KEY = key;
    }
  });

  it("reports the provider as needing partner access on the Host page", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/host/integrations",
      cookies: host.cookies,
    });

    const channex = response
      .json()
      .items.find((item: { provider: string }) => item.provider === "CHANNEX");

    // No CHANNEX_API_KEY in this deployment: outbound booking delivery is not
    // available, and the UI is told so rather than shown a Connect button.
    expect(channex.available).toBe(false);
    expect(channex.statusReason).toBe("PARTNER_ACCESS_REQUIRED");
  });
});
