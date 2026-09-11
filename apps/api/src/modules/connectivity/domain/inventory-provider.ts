import type { ExternalProvider } from "../../../infrastructure/database/schema";

/**
 * A PMS that Rezervio calls.
 *
 * This is the **client** direction: Rezervio holds credentials for somebody
 * else's system, asks it what it knows, and tells it what Rezervio has sold.
 * Hostaway is this shape.
 *
 * Channex deliberately does *not* implement this interface — there, Rezervio is
 * the channel and the calls run the other way. Forcing both into one interface
 * would produce methods that are meaningless on one side, which is exactly how
 * an integration ends up pretending to do something it cannot
 * (milestone 12 §17, §20).
 */
export const INVENTORY_PROVIDERS = Symbol("INVENTORY_PROVIDERS");

/** What the Host has at the provider, reduced to what mapping needs. */
export type ExternalListing = {
  externalId: string;
  name: string;
  /** Free-text location line, purely to help a human recognise the listing. */
  address: string | null;
};

/**
 * A reservation as the provider states it.
 *
 * Deliberately small. Rezervio needs to know which listing, which dates and
 * whether it still stands; photos, pricing and messages are explicitly out of
 * scope (milestone 12 §12).
 */
export type ExternalReservation = {
  externalId: string;
  externalListingId: string;
  /** Half-open `[checkIn, checkOut)`, like every other range in Rezervio. */
  checkIn: string;
  checkOut: string;
  status: ExternalReservationStatus;
  guestName: string | null;
  guestCount: number | null;
  /** Which sales channel it came from, when the provider says. */
  channel: string | null;
};

/**
 * Reduced from whatever vocabulary the provider uses.
 *
 * Only three states matter here: does this reservation block the calendar, has
 * it gone away, or is it still undecided.
 */
export const EXTERNAL_RESERVATION_STATUSES = ["ACTIVE", "CANCELLED", "PENDING"] as const;
export type ExternalReservationStatus = (typeof EXTERNAL_RESERVATION_STATUSES)[number];

export type PushReservationInput = {
  externalListingId: string;
  /** Our own Booking id, used as the provider-side idempotency anchor. */
  bookingId: string;
  bookingReference: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  adults: number;
  children: number;
  totalAmountMinor: number;
  currency: string;
};

export type ProviderCredentials = Record<string, string>;

export interface InventoryProvider {
  readonly provider: ExternalProvider;

  /**
   * Proves the credentials work and returns the provider-side account id.
   * Called when a Host connects and whenever a connection is refreshed.
   */
  verifyCredentials(credentials: ProviderCredentials): Promise<{ externalAccountId: string }>;

  listListings(credentials: ProviderCredentials): Promise<ExternalListing[]>;

  /**
   * Reservations touching a window, for one listing.
   *
   * Windowed rather than "everything": a reconciliation pass that pages
   * through a professional Host's whole history would be slow, pointless and
   * rude to the provider.
   */
  listReservations(
    credentials: ProviderCredentials,
    input: { externalListingId: string; from: string; to: string },
  ): Promise<ExternalReservation[]>;

  getReservation(
    credentials: ProviderCredentials,
    externalReservationId: string,
  ): Promise<ExternalReservation | null>;

  /**
   * Sends a confirmed Rezervio Booking to the provider so its other channels
   * stop selling the dates.
   */
  createReservation(
    credentials: ProviderCredentials,
    input: PushReservationInput,
  ): Promise<{ externalReservationId: string }>;

  cancelReservation(
    credentials: ProviderCredentials,
    externalReservationId: string,
  ): Promise<void>;
}
