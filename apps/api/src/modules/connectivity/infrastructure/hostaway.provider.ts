import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { ExternalProvider } from "../../../infrastructure/database/schema";
import { ProviderError } from "../domain/provider-errors";
import type {
  ExternalListing,
  ExternalReservation,
  ExternalReservationStatus,
  InventoryProvider,
  ProviderCredentials,
  PushReservationInput,
} from "../domain/inventory-provider";
import { providerFetch } from "./provider-http";

/**
 * Hostaway, as documented by its public API.
 *
 * Every path below is from that documentation and nothing is invented
 * (milestone 12 §48):
 *
 * ```text
 * POST   /v1/accessTokens                      client_credentials → bearer token
 * GET    /v1/listings                          the Host's listings
 * GET    /v1/reservations                      reservations, filterable by listing and date
 * GET    /v1/reservations/{id}
 * POST   /v1/reservations                      create
 * DELETE /v1/reservations/{id}                 cancel
 * ```
 */
const HOSTAWAY_HOST = "hostaway.com";
const DEFAULT_BASE_URL = "https://api.hostaway.com";

/**
 * Hostaway's own reservation vocabulary, reduced to the three states Rezervio
 * distinguishes. `ownerStay` blocks the calendar exactly as a sale does — the
 * dates are unavailable either way.
 */
function toReservationStatus(raw: string | null | undefined): ExternalReservationStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "cancelled":
    case "declined":
    case "expired":
      return "CANCELLED";
    case "new":
    case "pending":
    case "inquiry":
    case "awaitingpayment":
      return "PENDING";
    default:
      // "accepted", "ownerStay", "modified" — anything that holds the dates.
      return "ACTIVE";
  }
}

type HostawayListing = {
  id: number;
  name?: string | null;
  internalListingName?: string | null;
  address?: string | null;
};

type HostawayReservation = {
  id: number;
  reservationId?: string | null;
  listingMapId: number;
  arrivalDate: string;
  departureDate: string;
  status?: string | null;
  guestName?: string | null;
  numberOfGuests?: number | null;
  channelName?: string | null;
};

@Injectable()
export class HostawayInventoryProvider implements InventoryProvider {
  readonly provider: ExternalProvider = "HOSTAWAY";
  private readonly logger = new Logger(HostawayInventoryProvider.name);

  /**
   * Access tokens are valid for months, so re-minting one per request would be
   * both slow and a good way to hit the rate limit. Cached per client id, in
   * memory only — a token is a credential and does not belong in a table that
   * is not encrypted.
   */
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (this.config.get<string>("HOSTAWAY_API_BASE_URL") ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
  }

  /**
   * The allowlist. Overridable only so the contract tests can point the
   * adapter at a local double; in every other environment it is Hostaway's own
   * domain and nothing else (milestone 12 §38).
   */
  private get allowedHosts(): string[] {
    const override = this.config.get<string>("HOSTAWAY_ALLOWED_HOSTS");
    return override ? override.split(",").map((host) => host.trim()) : [HOSTAWAY_HOST];
  }

  async verifyCredentials(
    credentials: ProviderCredentials,
  ): Promise<{ externalAccountId: string }> {
    const token = await this.accessToken(credentials, { force: true });

    // A token alone proves the secret; one real call proves the scope.
    await this.get<{ result?: unknown }>(token, "/v1/listings?limit=1");

    return { externalAccountId: credentials.accountId };
  }

  async listListings(credentials: ProviderCredentials): Promise<ExternalListing[]> {
    const token = await this.accessToken(credentials);
    const body = await this.get<{ result?: HostawayListing[] }>(
      token,
      "/v1/listings?limit=200",
    );

    return (body.result ?? []).map((listing) => ({
      externalId: String(listing.id),
      name: listing.internalListingName ?? listing.name ?? `Listing ${listing.id}`,
      address: listing.address ?? null,
    }));
  }

  async listReservations(
    credentials: ProviderCredentials,
    input: { externalListingId: string; from: string; to: string },
  ): Promise<ExternalReservation[]> {
    const token = await this.accessToken(credentials);

    const query = new URLSearchParams({
      listingId: input.externalListingId,
      arrivalStartDate: input.from,
      arrivalEndDate: input.to,
      limit: "200",
    });

    const body = await this.get<{ result?: HostawayReservation[] }>(
      token,
      `/v1/reservations?${query.toString()}`,
    );

    return (body.result ?? []).map(toReservation);
  }

  async getReservation(
    credentials: ProviderCredentials,
    externalReservationId: string,
  ): Promise<ExternalReservation | null> {
    const token = await this.accessToken(credentials);

    try {
      const body = await this.get<{ result?: HostawayReservation }>(
        token,
        `/v1/reservations/${encodeURIComponent(externalReservationId)}`,
      );
      return body.result ? toReservation(body.result) : null;
    } catch (error) {
      // A reservation Hostaway has never heard of is an answer, not a failure:
      // reconciliation uses it to conclude the reservation is gone.
      if (error instanceof ProviderError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }

  /**
   * Pushes a confirmed Rezervio Booking so Hostaway's other channels stop
   * selling the dates.
   *
   * `channelName: "direct"` because that is what a Rezervio sale is from
   * Hostaway's point of view — a booking taken outside the OTAs it manages.
   */
  async createReservation(
    credentials: ProviderCredentials,
    input: PushReservationInput,
  ): Promise<{ externalReservationId: string }> {
    const token = await this.accessToken(credentials);

    const body = await this.post<{ result?: { id?: number } }>(token, "/v1/reservations", {
      listingMapId: Number(input.externalListingId),
      channelName: "direct",
      // The Rezervio reference travels with it, so a human looking at either
      // system can find the other side of the same Stay.
      externalReservationId: input.bookingReference,
      arrivalDate: input.checkIn,
      departureDate: input.checkOut,
      guestName: input.guestName,
      numberOfGuests: input.adults + input.children,
      adults: input.adults,
      children: input.children,
      totalPrice: input.totalAmountMinor / 100,
      currency: input.currency,
      status: "new",
    });

    const id = body.result?.id;
    if (id === undefined) {
      throw new ProviderError(
        "Dostawca nie zwrócił identyfikatora rezerwacji.",
        "PROVIDER_RESPONSE_INVALID",
        true,
      );
    }

    return { externalReservationId: String(id) };
  }

  async cancelReservation(
    credentials: ProviderCredentials,
    externalReservationId: string,
  ): Promise<void> {
    const token = await this.accessToken(credentials);

    try {
      await this.request(token, "DELETE", `/v1/reservations/${encodeURIComponent(externalReservationId)}`);
    } catch (error) {
      // Already gone is the state we wanted. Cancelling twice must succeed
      // twice, or every retry would end in a failure that needs a human.
      if (error instanceof ProviderError && error.code === "NOT_FOUND") return;
      throw error;
    }
  }

  // ------------------------------------------------------------------ token

  /**
   * `POST /v1/accessTokens`, client credentials.
   *
   * Hostaway notes the token is valid one second after it is returned, so a
   * freshly minted token is used on the *next* call rather than immediately —
   * the cache entry below is written before any request uses it.
   */
  private async accessToken(
    credentials: ProviderCredentials,
    options: { force?: boolean } = {},
  ): Promise<string> {
    const accountId = credentials.accountId;
    const secret = credentials.apiKey;

    if (!accountId || !secret) {
      throw new ProviderError(
        "Połączenie nie ma kompletu danych logowania.",
        "CREDENTIALS_MISSING",
        false,
      );
    }

    const cached = this.tokens.get(accountId);
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.token;

    const response = await providerFetch(
      {
        method: "POST",
        url: `${this.baseUrl}/v1/accessTokens`,
        headers: { "cache-control": "no-cache" },
        form: {
          grant_type: "client_credentials",
          client_id: accountId,
          client_secret: secret,
          scope: "general",
        },
      },
      this.allowedHosts,
    );

    const body = response.body as { access_token?: string; expires_in?: number } | null;
    if (!body?.access_token) {
      throw new ProviderError(
        "Dostawca nie zwrócił tokenu dostępu.",
        "CREDENTIALS_REJECTED",
        false,
      );
    }

    // Re-mint well before expiry rather than at it; a token that expires
    // mid-reconciliation would fail a whole batch for no reason.
    const ttlMs = Math.max(60, (body.expires_in ?? 3600) - 300) * 1000;
    this.tokens.set(accountId, { token: body.access_token, expiresAt: Date.now() + ttlMs });

    this.logger.log({ event: "hostaway.token_issued", accountId });
    return body.access_token;
  }

  // --------------------------------------------------------------- requests

  private async get<T>(token: string, path: string): Promise<T> {
    return (await this.request(token, "GET", path)) as T;
  }

  private async post<T>(token: string, path: string, body: unknown): Promise<T> {
    return (await this.request(token, "POST", path, body)) as T;
  }

  private async request(
    token: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await providerFetch(
      {
        method,
        url: `${this.baseUrl}${path}`,
        headers: { authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body }),
      },
      this.allowedHosts,
    );

    return response.body ?? {};
  }
}

function toReservation(row: HostawayReservation): ExternalReservation {
  return {
    externalId: String(row.id),
    externalListingId: String(row.listingMapId),
    checkIn: row.arrivalDate,
    checkOut: row.departureDate,
    status: toReservationStatus(row.status),
    guestName: row.guestName ?? null,
    guestCount: row.numberOfGuests ?? null,
    channel: row.channelName ?? null,
  };
}
