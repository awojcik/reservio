/**
 * A channel manager for which Rezervio is the **channel**.
 *
 * The relationship is inverted compared to a PMS integration, and the
 * interface is inverted with it. Channex is this shape (milestone 12 §17–§20):
 *
 * ```text
 * Channex → Rezervio    availability, rates, restrictions, mapping requests
 * Rezervio → Channex    a Rezervio Booking, a cancellation, an availability check
 * ```
 *
 * So most of the "integration" is not a client at all: it is a small set of
 * endpoints Rezervio serves, which Channex calls on its own schedule. Only the
 * booking direction is an outbound call, and that is all this interface has.
 *
 * Modelled from Channex's published Open Channel API. Nothing here is invented:
 * every field name below appears in that contract.
 */
export const CHANNEL_PROVIDER = Symbol("CHANNEL_PROVIDER");

/**
 * Rezervio's own inventory, in the shape the channel manager asks for.
 *
 * Channex's model is hotel-shaped — room types, each with rate plans. Rezervio
 * is deliberately not: one Property is one independently bookable unit, with
 * no room types and no allotment. The mapping is therefore always one room type
 * with one rate plan and `availability` of 0 or 1, and that is a real modelling
 * limit rather than a simplification (domain language §1).
 */
export type ChannelRoomType = {
  id: string;
  title: string;
  ratePlans: ChannelRatePlan[];
};

export type ChannelRatePlan = {
  id: string;
  title: string;
  /** Channex vocabulary: `per_room` or `per_person`. Rezervio sells per unit. */
  sellMode: "per_room" | "per_person";
  maxPersons: number;
  currency: string;
  readOnly: boolean;
};

/** One availability statement from the channel manager. */
export type ChannelAvailabilityChange = {
  roomTypeId: string;
  ratePlanId: string | null;
  dateFrom: string;
  dateTo: string;
  /** Units bookable. For a Rezervio Property this is 0 or 1. */
  availability: number;
};

/** A restriction statement. Rezervio acts on `stopSell` and ignores the rest. */
export type ChannelRestrictionChange = {
  roomTypeId: string;
  ratePlanId: string | null;
  dateFrom: string;
  dateTo: string;
  stopSell: boolean | null;
};

export type ChannelChanges = {
  requestId: string;
  hotelCode: string;
  availability: ChannelAvailabilityChange[];
  restrictions: ChannelRestrictionChange[];
};

/**
 * A Rezervio Booking, as the channel manager's booking-push contract expects
 * it. `status` carries the revision: `new`, `modified` or `cancelled`.
 */
export type ChannelBookingPush = {
  status: "new" | "modified" | "cancelled";
  hotelCode: string;
  reservationId: string;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  customer: { name: string; surname: string; mail: string | null };
  rooms: {
    index: number;
    roomTypeCode: string;
    ratePlanCode: string;
    occupancy: { adults: number; children: number; infants: number };
    days: { date: string; price: string }[];
  }[];
};

export type ChannelPushResult = {
  accepted: boolean;
  /** The channel manager's own id for the booking, when it returns one. */
  providerBookingId: string | null;
};

export interface ChannelProvider {
  /**
   * Whether this deployment actually holds channel credentials.
   *
   * A channel integration needs more than an API key: a staging account, a
   * registered channel, and a passed certification. Until those exist, every
   * method below refuses rather than guessing — and the connection says
   * `PARTNER_ACCESS_REQUIRED` instead of pretending to be connected
   * (milestone 12 §18, §21).
   */
  readonly configured: boolean;

  /** Delivers a Rezervio Booking, a modification, or a cancellation. */
  pushBooking(booking: ChannelBookingPush): Promise<ChannelPushResult>;

  /**
   * Asks whether the dates are still sellable before Rezervio commits to them.
   * Advisory: Rezervio's own PostgreSQL remains the deciding authority.
   */
  checkAvailability(booking: ChannelBookingPush): Promise<{ available: boolean }>;

  /** Asks the channel manager to resend the full property state. */
  requestFullSync(hotelCode: string): Promise<void>;
}
