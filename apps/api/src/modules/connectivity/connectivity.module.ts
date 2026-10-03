import { Module } from "@nestjs/common";

import { OutboxModule } from "../../infrastructure/outbox/outbox.module";
import { AuthModule } from "../auth/auth.module";
import { ChannexChangesService } from "./application/channex-changes.service";
import { ConnectionsService } from "./application/connections.service";
import { ExternalSyncWorker } from "./application/external-sync.worker";
import { InboundReservationsService } from "./application/inbound-reservations.service";
import { InventorySyncService } from "./application/inventory-sync.service";
import { MappingsService } from "./application/mappings.service";
import { OutboundReservationsService } from "./application/outbound-reservations.service";
import { ProviderEventsService } from "./application/provider-events.service";
import { ProviderRegistry } from "./application/provider-registry";
import { HostIntegrationsController } from "./host-integrations.controller";
import { ChannexChannelProvider } from "./infrastructure/channex.provider";
import { ProviderCredentialsCipher } from "./infrastructure/credentials.cipher";
import { HostawayInventoryProvider } from "./infrastructure/hostaway.provider";
import { ChannexChannelController } from "./webhooks/channex-channel.controller";
import { HostawayWebhookController } from "./webhooks/hostaway-webhook.controller";

/**
 * Connectivity with external PMS and channel managers.
 *
 * Depends on nothing in the domain beyond availability and Bookings, and is
 * depended on by nobody — the arrow points one way. Payments reaches it
 * through the transactional outbox rather than by importing it, so confirming
 * a Booking never waits on a provider being reachable (milestone 12 §14, §30).
 */
@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [
    HostIntegrationsController,
    HostawayWebhookController,
    ChannexChannelController,
  ],
  providers: [
    ProviderCredentialsCipher,
    HostawayInventoryProvider,
    ChannexChannelProvider,
    ProviderRegistry,
    ConnectionsService,
    MappingsService,
    InboundReservationsService,
    OutboundReservationsService,
    InventorySyncService,
    ProviderEventsService,
    ChannexChangesService,
    ExternalSyncWorker,
  ],
  exports: [
    ConnectionsService,
    MappingsService,
    InboundReservationsService,
    OutboundReservationsService,
    InventorySyncService,
    ProviderEventsService,
    ProviderRegistry,
    ExternalSyncWorker,
  ],
})
export class ConnectivityModule {}
