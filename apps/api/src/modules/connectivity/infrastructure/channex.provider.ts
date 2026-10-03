import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PartnerAccessRequiredError, ProviderError } from "../domain/provider-errors";
import type {
  ChannelBookingPush,
  ChannelProvider,
  ChannelPushResult,
} from "../domain/channel-provider";
import { providerFetch } from "./provider-http";

/**
 * Channex, where Rezervio is the **channel** rather than the client.
 *
 * Only three calls run outward, and all three are from Channex's published
 * Open Channel API:
 *
 * ```text
 * POST /api/v1/channel_webhooks/open_channel/new_booking
 * POST /api/v1/channel_webhooks/open_channel/booking_availability_check
 * POST /api/v1/channel_webhooks/open_channel/request_full_sync
 * ```
 *
 * Everything else in that contract runs the other way: Channex calls endpoints
 * that Rezervio serves. Those live in `ChannexChannelController`, not here —
 * which is the whole reason this class is not shaped like the Hostaway adapter
 * (milestone 12 §17, §20).
 *
 * Nothing in this file is guessed. Where the contract is silent — the response
 * body of a booking push, for instance — the code treats the absence as
 * unknown rather than assuming a shape.
 */
const CHANNEX_HOST = "channex.io";
const DEFAULT_BASE_URL = "https://secure.channex.io";

@Injectable()
export class ChannexChannelProvider implements ChannelProvider {
  private readonly logger = new Logger(ChannexChannelProvider.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * A channel integration needs more than a key.
   *
   * Channex requires a staging account, a registered Open Channel, a hotel
   * code and a passed certification before any of this does anything. Until
   * the API key exists, this deployment has none of that, and saying so is the
   * honest answer — the alternative is an integration that reports success
   * against endpoints nobody has been admitted to (milestone 12 §18, §21).
   */
  get configured(): boolean {
    return Boolean((this.config.get<string>("CHANNEX_API_KEY") ?? "").trim());
  }

  private get baseUrl(): string {
    return (this.config.get<string>("CHANNEX_API_BASE_URL") ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
  }

  private get allowedHosts(): string[] {
    const override = this.config.get<string>("CHANNEX_ALLOWED_HOSTS");
    return override ? override.split(",").map((host) => host.trim()) : [CHANNEX_HOST];
  }

  private requireKey(): string {
    const key = (this.config.get<string>("CHANNEX_API_KEY") ?? "").trim();

    if (!key) {
      throw new PartnerAccessRequiredError(
        "Rezervio nie ma jeszcze dostępu partnerskiego Channex (konto staging, Open Channel, certyfikacja).",
      );
    }

    return key;
  }

  async pushBooking(booking: ChannelBookingPush): Promise<ChannelPushResult> {
    const body = await this.post("new_booking", booking);

    /*
     * The contract does not specify a response body for a booking push, so no
     * particular shape is assumed. A 2xx is the acknowledgement; an id is read
     * only if one happens to be there.
     */
    const providerBookingId =
      body && typeof body === "object"
        ? ((body as { booking_id?: string; id?: string }).booking_id ??
          (body as { id?: string }).id ??
          null)
        : null;

    this.logger.log({
      event: "channex.booking_pushed",
      status: booking.status,
      reservationId: booking.reservationId,
    });

    return { accepted: true, providerBookingId };
  }

  async checkAvailability(booking: ChannelBookingPush): Promise<{ available: boolean }> {
    const body = await this.post("booking_availability_check", booking);

    /*
     * Advisory only. Rezervio's own PostgreSQL decides whether a Stay may be
     * sold; this answer informs, it does not authorise (milestone 12 §1).
     */
    const available =
      body && typeof body === "object"
        ? (body as { available?: boolean }).available !== false
        : true;

    return { available };
  }

  async requestFullSync(hotelCode: string): Promise<void> {
    await this.post("request_full_sync", { hotel_code: hotelCode });
  }

  private async post(action: string, body: unknown): Promise<unknown> {
    const key = this.requireKey();

    const response = await providerFetch(
      {
        method: "POST",
        url: `${this.baseUrl}/api/v1/channel_webhooks/open_channel/${action}`,
        headers: { "api-key": key },
        body,
      },
      this.allowedHosts,
    );

    if (response.status >= 300) {
      throw new ProviderError(
        `Channex odpowiedział ${response.status}.`,
        "PROVIDER_REJECTED",
        false,
        response.status,
      );
    }

    return response.body;
  }
}
