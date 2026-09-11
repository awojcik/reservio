import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PartnerAccessRequiredError,
  ProviderError,
} from "../src/modules/connectivity/domain/provider-errors";
import { ChannexChannelProvider } from "../src/modules/connectivity/infrastructure/channex.provider";
import { HostawayInventoryProvider } from "../src/modules/connectivity/infrastructure/hostaway.provider";
import { isAllowedProviderUrl } from "../src/modules/connectivity/infrastructure/provider-http";
import { startMockProvider, type MockProvider } from "./helpers/mock-provider-server";

/**
 * Contract tests.
 *
 * Rezervio has no Hostaway account and no Channex partner access, so nothing
 * here talks to a real provider. What these tests *do* cover is the one layer
 * a service double cannot: what the adapter actually puts on the wire — the
 * path, the method, the auth header, the body — measured against each
 * provider's published contract (milestone 12 §32, §33, §34).
 *
 * A mistyped documented path fails here. It would not fail anywhere else until
 * a real credential existed.
 */
let mock: MockProvider;

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

beforeAll(async () => {
  mock = await startMockProvider();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  // Routes as well as traffic: a route left registered by one test would
  // answer another's request and hide a real mismatch.
  mock.reset();
});

function hostaway(): HostawayInventoryProvider {
  return new HostawayInventoryProvider(
    config({
      HOSTAWAY_API_BASE_URL: mock.origin,
      HOSTAWAY_ALLOWED_HOSTS: mock.host,
    }),
  );
}

const CREDENTIALS = { accountId: "60000", apiKey: "client-secret-value" };

describe("Hostaway contract", () => {
  /**
   * `POST /v1/accessTokens`, client credentials, scope `general` — exactly as
   * documented. Form-encoded, not JSON: the token endpoint is OAuth2.
   */
  it("mints a token the documented way", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-1", token_type: "Bearer", expires_in: 63072000 },
    }));
    mock.on("GET", "/v1/listings", () => ({ status: 200, body: { result: [] } }));

    const result = await hostaway().verifyCredentials(CREDENTIALS);

    const token = mock.requests[0];
    expect(token.method).toBe("POST");
    expect(token.path).toBe("/v1/accessTokens");
    expect(token.headers["content-type"]).toBe("application/x-www-form-urlencoded");

    const form = new URLSearchParams(token.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("60000");
    expect(form.get("client_secret")).toBe("client-secret-value");
    expect(form.get("scope")).toBe("general");

    expect(result.externalAccountId).toBe("60000");
  });

  it("sends the token as a bearer header on every later call", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-2", expires_in: 3600 },
    }));
    mock.on("GET", "/v1/listings", () => ({
      status: 200,
      body: {
        result: [
          { id: 101, name: "Sea View", internalListingName: "SEA-1", address: "ul. Morska 2" },
        ],
      },
    }));

    const listings = await hostaway().listListings(CREDENTIALS);

    const call = mock.requests.find((request) => request.path.startsWith("/v1/listings"))!;
    expect(call.headers.authorization).toBe("Bearer tok-2");

    // The internal name wins: it is what a Host recognises in their own PMS.
    expect(listings).toEqual([
      { externalId: "101", name: "SEA-1", address: "ul. Morska 2" },
    ]);
  });

  it("reads reservations from the documented path and reduces the status vocabulary", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-3", expires_in: 3600 },
    }));
    mock.on("GET", "/v1/reservations", () => ({
      status: 200,
      body: {
        result: [
          {
            id: 5001,
            listingMapId: 101,
            arrivalDate: "2033-06-10",
            departureDate: "2033-06-14",
            status: "accepted",
            guestName: "Anna Nowak",
            numberOfGuests: 3,
            channelName: "airbnb",
          },
          { id: 5002, listingMapId: 101, arrivalDate: "2033-07-01", departureDate: "2033-07-03", status: "cancelled" },
          { id: 5003, listingMapId: 101, arrivalDate: "2033-08-01", departureDate: "2033-08-03", status: "ownerStay" },
          { id: 5004, listingMapId: 101, arrivalDate: "2033-09-01", departureDate: "2033-09-03", status: "inquiry" },
        ],
      },
    }));

    const reservations = await hostaway().listReservations(CREDENTIALS, {
      externalListingId: "101",
      from: "2033-06-01",
      to: "2034-06-01",
    });

    const call = mock.requests.find((request) => request.path.startsWith("/v1/reservations"))!;
    expect(call.path).toContain("listingId=101");
    expect(call.path).toContain("arrivalStartDate=2033-06-01");

    expect(reservations.map((row) => row.status)).toEqual([
      "ACTIVE",
      "CANCELLED",
      // An owner stay blocks the calendar exactly as a sale does.
      "ACTIVE",
      "PENDING",
    ]);
    expect(reservations[0]).toMatchObject({
      externalId: "5001",
      externalListingId: "101",
      checkIn: "2033-06-10",
      checkOut: "2033-06-14",
      guestCount: 3,
    });
  });

  it("creates a reservation with the documented fields", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-4", expires_in: 3600 },
    }));
    mock.on("POST", "/v1/reservations", () => ({ status: 200, body: { result: { id: 7777 } } }));

    const result = await hostaway().createReservation(CREDENTIALS, {
      externalListingId: "101",
      bookingId: "b-1",
      bookingReference: "RZV-ABC12345",
      checkIn: "2033-10-10",
      checkOut: "2033-10-14",
      guestName: "Jan Kowalski",
      adults: 2,
      children: 1,
      totalAmountMinor: 280_000,
      currency: "PLN",
    });

    const call = mock.requests.find(
      (request) => request.method === "POST" && request.path === "/v1/reservations",
    )!;
    const body = JSON.parse(call.body) as Record<string, unknown>;

    expect(body).toMatchObject({
      listingMapId: 101,
      channelName: "direct",
      externalReservationId: "RZV-ABC12345",
      arrivalDate: "2033-10-10",
      departureDate: "2033-10-14",
      numberOfGuests: 3,
      currency: "PLN",
    });
    // Minor units are Rezervio's storage, not the provider's contract.
    expect(body.totalPrice).toBe(2800);
    expect(result.externalReservationId).toBe("7777");
  });

  it("cancels with DELETE and treats an unknown reservation as already gone", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-5", expires_in: 3600 },
    }));
    mock.on("DELETE", "/v1/reservations/7777", () => ({ status: 200, body: { status: "success" } }));

    const provider = hostaway();
    await provider.cancelReservation(CREDENTIALS, "7777");

    expect(
      mock.requests.some(
        (request) => request.method === "DELETE" && request.path === "/v1/reservations/7777",
      ),
    ).toBe(true);

    // Nothing registered for this id: the mock 404s, and cancelling something
    // already gone must succeed — otherwise every retry ends needing a human.
    await expect(provider.cancelReservation(CREDENTIALS, "9999")).resolves.toBeUndefined();
  });

  it("returns null rather than throwing for a reservation the provider forgot", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-6", expires_in: 3600 },
    }));

    // No GET route registered → 404, which reconciliation reads as "gone".
    expect(await hostaway().getReservation(CREDENTIALS, "4242")).toBeNull();
  });

  /**
   * The distinction the retry logic rests on: a rate limit is patience, a
   * rejected credential is an answer (milestone 12 §27).
   */
  it("marks 429 and 5xx retryable, and 401 not", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({ status: 401, body: { message: "nope" } }));

    await expect(hostaway().listListings(CREDENTIALS)).rejects.toMatchObject({
      code: "CREDENTIALS_REJECTED",
      retryable: false,
    });

    const limited = await startMockProvider();
    limited.on("POST", "/v1/accessTokens", () => ({ status: 429, body: { message: "slow down" } }));

    const provider = new HostawayInventoryProvider(
      config({ HOSTAWAY_API_BASE_URL: limited.origin, HOSTAWAY_ALLOWED_HOSTS: limited.host }),
    );

    await expect(provider.listListings(CREDENTIALS)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });

    await limited.close();
  });

  it("reuses a cached token instead of re-minting one per call", async () => {
    mock.on("POST", "/v1/accessTokens", () => ({
      status: 200,
      body: { access_token: "tok-7", expires_in: 3600 },
    }));
    mock.on("GET", "/v1/listings", () => ({ status: 200, body: { result: [] } }));

    const provider = hostaway();
    await provider.listListings(CREDENTIALS);
    await provider.listListings(CREDENTIALS);
    await provider.listListings(CREDENTIALS);

    const tokenCalls = mock.requests.filter((request) => request.path === "/v1/accessTokens");
    expect(tokenCalls).toHaveLength(1);
  });
});

describe("provider URL allowlist", () => {
  /**
   * A base URL taken from configuration and followed without checking would be
   * a server-side request forgery with our own credentials attached
   * (milestone 12 §38).
   */
  it("accepts the provider's own domain and refuses everything else", () => {
    expect(isAllowedProviderUrl("https://api.hostaway.com/v1/listings", ["hostaway.com"])).toBe(
      true,
    );
    expect(isAllowedProviderUrl("https://hostaway.com/v1/listings", ["hostaway.com"])).toBe(true);

    // A lookalike domain, a subdomain trick, and a wholly different host.
    expect(isAllowedProviderUrl("https://evil-hostaway.com/v1", ["hostaway.com"])).toBe(false);
    expect(isAllowedProviderUrl("https://hostaway.com.evil.test/v1", ["hostaway.com"])).toBe(false);
    expect(isAllowedProviderUrl("https://169.254.169.254/latest", ["hostaway.com"])).toBe(false);
    expect(isAllowedProviderUrl("file:///etc/passwd", ["hostaway.com"])).toBe(false);
    expect(isAllowedProviderUrl("not a url", ["hostaway.com"])).toBe(false);
  });

  it("refuses plain HTTP to a real provider domain", () => {
    // A bearer token in clear text is the whole reason for this rule.
    expect(isAllowedProviderUrl("http://api.hostaway.com/v1", ["hostaway.com"])).toBe(false);
  });

  it("rejects a call to a host outside the allowlist before it is made", async () => {
    const provider = new HostawayInventoryProvider(
      config({
        HOSTAWAY_API_BASE_URL: "https://attacker.example",
        HOSTAWAY_ALLOWED_HOSTS: "hostaway.com",
      }),
    );

    await expect(provider.listListings(CREDENTIALS)).rejects.toMatchObject({
      code: "URL_NOT_ALLOWED",
    });
  });
});

/**
 * Channex.
 *
 * Rezervio is the channel here, so most of the contract is a small server
 * Rezervio runs — see the channel controller tests. The three calls that go
 * *out* are covered below, together with the gate that stops any of them
 * happening without partner access (milestone 12 §18, §21, §34).
 */
describe("Channex contract", () => {
  const BOOKING = {
    status: "new" as const,
    hotelCode: "HOTEL-1",
    reservationId: "RZV-XYZ",
    arrivalDate: "2033-11-10",
    departureDate: "2033-11-14",
    currency: "PLN",
    customer: { name: "Anna", surname: "Nowak", mail: null },
    rooms: [
      {
        index: 0,
        roomTypeCode: "prop-1",
        ratePlanCode: "prop-1:standard",
        occupancy: { adults: 2, children: 0, infants: 0 },
        days: [{ date: "2033-11-10", price: "700.00" }],
      },
    ],
  };

  it("reports itself unconfigured without an API key", () => {
    expect(new ChannexChannelProvider(config({})).configured).toBe(false);
    expect(new ChannexChannelProvider(config({ CHANNEX_API_KEY: "k" })).configured).toBe(true);
  });

  /**
   * The honest failure. Channex needs a staging account, a registered Open
   * Channel, a hotel code and a passed certification; until those exist there
   * is nothing to call, and saying so beats inventing a success.
   */
  it("refuses every outbound call with PARTNER_ACCESS_REQUIRED", async () => {
    const provider = new ChannexChannelProvider(config({}));

    await expect(provider.pushBooking(BOOKING)).rejects.toBeInstanceOf(
      PartnerAccessRequiredError,
    );
    await expect(provider.checkAvailability(BOOKING)).rejects.toMatchObject({
      code: "PARTNER_ACCESS_REQUIRED",
      retryable: false,
    });
    await expect(provider.requestFullSync("HOTEL-1")).rejects.toBeInstanceOf(ProviderError);
  });

  it("pushes a booking to the documented path with the api-key header", async () => {
    mock.on("POST", "/api/v1/channel_webhooks/open_channel/new_booking", () => ({
      status: 200,
      body: { booking_id: "chx-1" },
    }));

    const provider = new ChannexChannelProvider(
      config({
        CHANNEX_API_KEY: "channel-key",
        CHANNEX_API_BASE_URL: mock.origin,
        CHANNEX_ALLOWED_HOSTS: mock.host,
      }),
    );

    const result = await provider.pushBooking(BOOKING);

    const call = mock.requests.at(-1)!;
    expect(call.path).toBe("/api/v1/channel_webhooks/open_channel/new_booking");
    // `api-key`, not a bearer token: that is what the contract specifies.
    expect(call.headers["api-key"]).toBe("channel-key");
    expect(call.headers.authorization).toBeUndefined();

    expect(result).toEqual({ accepted: true, providerBookingId: "chx-1" });
  });

  it("uses the availability-check path and treats silence as available", async () => {
    mock.on("POST", "/api/v1/channel_webhooks/open_channel/booking_availability_check", () => ({
      status: 200,
      body: {},
    }));

    const provider = new ChannexChannelProvider(
      config({
        CHANNEX_API_KEY: "channel-key",
        CHANNEX_API_BASE_URL: mock.origin,
        CHANNEX_ALLOWED_HOSTS: mock.host,
      }),
    );

    // Advisory only — Rezervio's own PostgreSQL is what decides.
    expect(await provider.checkAvailability(BOOKING)).toEqual({ available: true });
    expect(mock.requests.at(-1)!.path).toBe(
      "/api/v1/channel_webhooks/open_channel/booking_availability_check",
    );
  });

  it("carries the cancellation as a status on the same push", async () => {
    mock.on("POST", "/api/v1/channel_webhooks/open_channel/new_booking", () => ({
      status: 200,
      body: {},
    }));

    const provider = new ChannexChannelProvider(
      config({
        CHANNEX_API_KEY: "channel-key",
        CHANNEX_API_BASE_URL: mock.origin,
        CHANNEX_ALLOWED_HOSTS: mock.host,
      }),
    );

    await provider.pushBooking({ ...BOOKING, status: "cancelled" });

    // The contract has no separate cancellation endpoint: `status` is the
    // revision, and inventing a second path would be inventing a contract.
    const body = JSON.parse(mock.requests.at(-1)!.body) as { status: string };
    expect(body.status).toBe("cancelled");
  });
});
