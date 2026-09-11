import { Injectable } from "@nestjs/common";

import type { ExternalProvider } from "../../../infrastructure/database/schema";
import type { ChannelProvider } from "../domain/channel-provider";
import type { InventoryProvider } from "../domain/inventory-provider";
import { ChannexChannelProvider } from "../infrastructure/channex.provider";
import { HostawayInventoryProvider } from "../infrastructure/hostaway.provider";

/**
 * Which adapter serves which provider — and, more usefully, which *kind* of
 * relationship each provider is.
 *
 * `inventoryProvider` returns null for CHANNEX on purpose. Channex is not a
 * PMS Rezervio calls; it is a channel manager that calls Rezervio, and there
 * is no meaningful `listListings` to hand back. Returning null is how the rest
 * of the system finds that out without a special case per call site
 * (milestone 12 §17, §20).
 */
@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly hostaway: HostawayInventoryProvider,
    private readonly channex: ChannexChannelProvider,
  ) {}

  /** The PMS-direction adapter, or null when the provider is not one. */
  inventoryProvider(provider: ExternalProvider): InventoryProvider | null {
    return provider === "HOSTAWAY" ? this.hostaway : null;
  }

  /** The channel-direction adapter, or null when the provider is not one. */
  channelProvider(provider: ExternalProvider): ChannelProvider | null {
    return provider === "CHANNEX" ? this.channex : null;
  }
}
