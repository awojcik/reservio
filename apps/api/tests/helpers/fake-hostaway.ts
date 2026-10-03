import type {
  ExternalListing,
  ExternalReservation,
  InventoryProvider,
  ProviderCredentials,
  PushReservationInput,
} from "../../src/modules/connectivity/domain/inventory-provider";
import { ProviderError } from "../../src/modules/connectivity/domain/provider-errors";
import type { ExternalProvider } from "../../src/infrastructure/database/schema";

/**
 * Stand-in for Hostaway.
 *
 * Shaped by the published contract — the same listing, reservation and status
 * vocabulary the real adapter maps — so a test that passes here is testing
 * Rezervio's half of a real integration rather than a shape we invented.
 *
 * It exists because Rezervio has no Hostaway account: the API is reachable and
 * documented, but every call without credentials is a 401. Everything below the
 * network boundary is therefore exercised in full, and the network boundary
 * itself is covered by the contract tests against a local HTTP double
 * (milestone 12 §33).
 */
export class FakeHostawayProvider implements InventoryProvider {
  readonly provider: ExternalProvider = "HOSTAWAY";

  readonly created: PushReservationInput[] = [];
  readonly cancelled: string[] = [];
  readonly verified: ProviderCredentials[] = [];

  private listings: ExternalListing[] = [];
  private reservations = new Map<string, ExternalReservation>();
  private failures = 0;
  private failureCode = "PROVIDER_UNAVAILABLE";
  private failureRetryable = true;
  private nextReservationId = 9000;

  setListings(listings: ExternalListing[]): void {
    this.listings = listings;
  }

  setReservations(reservations: ExternalReservation[]): void {
    this.reservations = new Map(reservations.map((row) => [row.externalId, row]));
  }

  upsertReservation(reservation: ExternalReservation): void {
    this.reservations.set(reservation.externalId, reservation);
  }

  removeReservation(externalId: string): void {
    this.reservations.delete(externalId);
  }

  /** Makes the next `times` calls fail, the way a provider outage would. */
  failNext(times: number, code = "PROVIDER_UNAVAILABLE", retryable = true): void {
    this.failures = times;
    this.failureCode = code;
    this.failureRetryable = retryable;
  }

  private maybeFail(): void {
    if (this.failures <= 0) return;
    this.failures -= 1;
    throw new ProviderError("Dostawca chwilowo niedostępny.", this.failureCode, this.failureRetryable);
  }

  verifyCredentials(credentials: ProviderCredentials): Promise<{ externalAccountId: string }> {
    this.maybeFail();
    this.verified.push(credentials);
    return Promise.resolve({ externalAccountId: credentials.accountId });
  }

  listListings(): Promise<ExternalListing[]> {
    this.maybeFail();
    return Promise.resolve([...this.listings]);
  }

  listReservations(
    _credentials: ProviderCredentials,
    input: { externalListingId: string },
  ): Promise<ExternalReservation[]> {
    this.maybeFail();
    return Promise.resolve(
      [...this.reservations.values()].filter(
        (row) => row.externalListingId === input.externalListingId,
      ),
    );
  }

  getReservation(
    _credentials: ProviderCredentials,
    externalReservationId: string,
  ): Promise<ExternalReservation | null> {
    this.maybeFail();
    return Promise.resolve(this.reservations.get(externalReservationId) ?? null);
  }

  /**
   * Records the push and mints an id, the way the real API does.
   *
   * Deliberately *not* idempotent: a second call creates a second reservation.
   * That is what the real provider would do, and it is the whole reason
   * Rezervio claims a row before calling (milestone 12 §14).
   */
  createReservation(
    _credentials: ProviderCredentials,
    input: PushReservationInput,
  ): Promise<{ externalReservationId: string }> {
    this.maybeFail();
    this.created.push(input);

    const externalId = String((this.nextReservationId += 1));
    this.reservations.set(externalId, {
      externalId,
      externalListingId: input.externalListingId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      status: "ACTIVE",
      guestName: input.guestName,
      guestCount: input.adults + input.children,
      channel: "direct",
    });

    return Promise.resolve({ externalReservationId: externalId });
  }

  cancelReservation(
    _credentials: ProviderCredentials,
    externalReservationId: string,
  ): Promise<void> {
    this.maybeFail();
    this.cancelled.push(externalReservationId);

    const existing = this.reservations.get(externalReservationId);
    if (existing) this.reservations.set(externalReservationId, { ...existing, status: "CANCELLED" });

    return Promise.resolve();
  }

  reset(): void {
    this.created.length = 0;
    this.cancelled.length = 0;
    this.verified.length = 0;
    this.failures = 0;
  }
}
