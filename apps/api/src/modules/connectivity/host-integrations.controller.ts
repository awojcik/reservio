import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { eq, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  properties,
  type ExternalInventoryConnectionRow,
  type ExternalProvider,
  type HostRow,
} from "../../infrastructure/database/schema";
import { toIsoOrNull } from "../../common/pg-values";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { CurrentHost, HostGuard } from "../auth/auth.guards";
import { ConnectionsService } from "./application/connections.service";
import { ExternalSyncWorker } from "./application/external-sync.worker";
import { InventorySyncService } from "./application/inventory-sync.service";
import { MappingsService } from "./application/mappings.service";
import { ProviderRegistry } from "./application/provider-registry";
import {
  ConnectHostawayDto,
  ConnectResultDto,
  CreateMappingDto,
  ExternalListingsDto,
  IntegrationDto,
  IntegrationsPageDto,
  PropertyMappingDto,
  SyncQueuedDto,
} from "./dto/integrations.dto";

/**
 * The Host's own integrations.
 *
 * Every route resolves the Host from the session and scopes by it. A Host
 * naming another Host's connection gets a 404 — the same answer they would get
 * for one that does not exist, so the response cannot be used to discover that
 * it does (milestone 12 §38).
 */
@ApiTags("host-integrations")
@ApiCookieAuth()
@UseGuards(HostGuard, RateLimitGuard)
@Controller("host/integrations")
export class HostIntegrationsController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly connections: ConnectionsService,
    private readonly mappings: MappingsService,
    private readonly sync: InventorySyncService,
    private readonly worker: ExternalSyncWorker,
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Integracje gospodarza",
    description:
      "Każdy dostawca, jego stan i ostatnie synchronizacje. Klucze API nigdy nie są zwracane.",
  })
  @ApiOkResponse({ type: IntegrationsPageDto })
  async list(@CurrentHost() host: HostRow): Promise<IntegrationsPageDto> {
    const rows = await this.connections.listForHost(host.id);
    const byProvider = new Map(rows.map((row) => [row.provider, row]));

    const items: IntegrationDto[] = [];
    for (const provider of ["HOSTAWAY", "CHANNEX"] as ExternalProvider[]) {
      items.push(await this.describe(provider, byProvider.get(provider) ?? null));
    }

    return { items, icalAlsoConnected: await this.hasIcalCalendars(host.id) };
  }

  /**
   * Connects Hostaway.
   *
   * The credentials are verified against the provider before anything is
   * stored: saving a key that does not work would leave a Host with a
   * connection that looks fine and silently syncs nothing.
   */
  @Post("hostaway/connect")
  @HttpCode(200)
  @RateLimit({ bucket: "integration-connect", limit: 10, windowSeconds: 300, scope: "user" })
  @ApiOperation({
    summary: "Połącz Hostaway",
    description:
      "Weryfikuje dane u dostawcy, zapisuje je zaszyfrowane i zwraca hasło webhooka — jeden raz.",
  })
  @ApiOkResponse({ type: ConnectResultDto })
  @ApiConflictResponse({ description: "CREDENTIALS_REJECTED / INTEGRATION_NOT_CONNECTED" })
  async connectHostaway(
    @CurrentHost() host: HostRow,
    @Body() dto: ConnectHostawayDto,
  ): Promise<ConnectResultDto> {
    const provider = this.registry.inventoryProvider("HOSTAWAY")!;
    const credentials = { accountId: dto.accountId, apiKey: dto.apiKey };

    const { externalAccountId } = await provider.verifyCredentials(credentials);

    /*
     * A fresh webhook secret each time a Host connects. Hostaway does not sign
     * its webhooks — its contract offers basic auth — so this is the whole of
     * the authentication on that endpoint, and reusing an old one after a
     * reconnect would keep a secret alive that the Host may have been trying to
     * rotate (milestone 12 §28).
     */
    const webhookSecret = ConnectionsService.newWebhookSecret();

    const connection = await this.connections.upsert({
      hostId: host.id,
      provider: "HOSTAWAY",
      credentials,
      externalAccountId,
      status: "CONNECTED",
      configuration: { webhookSecret },
    });

    await this.worker.enqueueSync(connection.id);

    return {
      integration: await this.describe("HOSTAWAY", connection),
      // Shown once. It is not readable afterwards, and no API returns it.
      webhookSecret,
    };
  }

  @Get(":id/properties")
  @ApiOperation({
    summary: "Listingi u dostawcy",
    description:
      "Propozycja dopasowania jest wyłącznie po dokładnej nazwie — mapowanie zatwierdza Host.",
  })
  @ApiOkResponse({ type: ExternalListingsDto })
  @ApiNotFoundResponse({ description: "Nie znaleziono połączenia" })
  async listings(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ExternalListingsDto> {
    const connection = await this.connections.ownedById(host.id, id);
    const { listings, alreadyMapped } = await this.sync.discoverListings(connection);

    const hostProperties = await this.database.db
      .select({ id: properties.id, title: properties.title })
      .from(properties)
      .where(eq(properties.hostId, host.id));

    return {
      items: listings.map((listing) => ({
        externalId: listing.externalId,
        name: listing.name,
        address: listing.address,
        mapped: alreadyMapped.has(listing.externalId),
        suggestedPropertyId:
          hostProperties.find(
            (property) =>
              property.title.trim().toLowerCase() === listing.name.trim().toLowerCase(),
          )?.id ?? null,
      })),
      mappings: await this.describeMappings(connection.id),
    };
  }

  @Post(":id/mappings")
  @ApiOperation({
    summary: "Zmapuj obiekt",
    description: "Jawna decyzja Hosta. Jeden obiekt do jednego listingu i odwrotnie.",
  })
  @ApiCreatedResponse({ type: PropertyMappingDto })
  @ApiConflictResponse({ description: "PROPERTY_ALREADY_MAPPED" })
  async createMapping(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateMappingDto,
  ): Promise<PropertyMappingDto> {
    const connection = await this.connections.ownedById(host.id, id);

    const mapping = await this.mappings.create({
      connectionId: connection.id,
      hostId: host.id,
      propertyId: dto.propertyId,
      externalPropertyId: dto.externalPropertyId,
      externalPropertyName: dto.externalPropertyName ?? null,
    });

    // A freshly mapped Property has a calendar Rezervio has never seen.
    await this.worker.enqueueSync(connection.id);

    const described = await this.describeMappings(connection.id);
    return described.find((row) => row.id === mapping.id)!;
  }

  @Delete(":id/mappings/:mappingId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Usuń mapowanie",
    description:
      "Zatrzymuje przyszłe synchronizacje. Blokady, które już powstały, zostają — opisują rezerwacje, które nadal istnieją u dostawcy.",
  })
  @ApiNoContentResponse()
  async removeMapping(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("mappingId", ParseUUIDPipe) mappingId: string,
  ): Promise<void> {
    const connection = await this.connections.ownedById(host.id, id);
    await this.mappings.remove(connection.id, mappingId);
  }

  @Post(":id/sync")
  @HttpCode(202)
  @RateLimit({ bucket: "integration-sync", limit: 10, windowSeconds: 300, scope: "route-param" })
  @ApiOperation({
    summary: "Synchronizuj teraz",
    description:
      "Zadanie trafia do kolejki — feed nie jest pobierany w wątku żądania. Powtórzone kliknięcia są deduplikowane.",
  })
  @ApiOkResponse({ type: SyncQueuedDto })
  async syncNow(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SyncQueuedDto> {
    const connection = await this.connections.ownedById(host.id, id);
    this.connections.assertUsable(connection);

    const { queued } = await this.worker.enqueueSync(connection.id);
    return { status: "QUEUED", queued };
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Rozłącz",
    description:
      "Zatrzymuje synchronizację. Mapowania i blokady zostają — usunięcie ich zwolniłoby terminy, które ktoś już sprzedał.",
  })
  @ApiNoContentResponse()
  async disconnect(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    const connection = await this.connections.ownedById(host.id, id);
    await this.connections.disable(connection.id, "DISABLED_BY_HOST");
  }

  // --------------------------------------------------------------- mapping

  private async describe(
    provider: ExternalProvider,
    connection: ExternalInventoryConnectionRow | null,
  ): Promise<IntegrationDto> {
    /*
     * Channex is not merely unconfigured — it needs a partner programme
     * Rezervio has not been admitted to. Saying so is the honest answer, and
     * the UI shows it rather than a "Connect" button that could not work
     * (milestone 12 §21).
     */
    const channel = this.registry.channelProvider(provider);
    const available = channel ? channel.configured : true;

    if (!connection) {
      return {
        id: null,
        provider,
        status: available ? "NOT_CONNECTED" : "ACTION_REQUIRED",
        statusReason: available ? null : "PARTNER_ACCESS_REQUIRED",
        available,
        externalAccountId: null,
        lastSuccessfulSyncAt: null,
        lastFailedSyncAt: null,
        lastErrorCode: null,
        mappedProperties: 0,
        recentSyncs: [],
        webhookUrl: null,
      };
    }

    const [mapped, attempts] = await Promise.all([
      this.connections.mappedPropertyCount(connection.id),
      this.connections.recentAttempts(connection.id, 5),
    ]);

    /*
     * A stored status cannot outrank the deployment's own capability. If this
     * Rezervio has no channel credentials, the connection is not usable
     * whatever the row says — reporting it as CONNECTED would be the panel
     * lying about something a Host would then rely on (milestone 12 §21).
     */
    return {
      id: connection.id,
      provider,
      status: available ? connection.status : "ACTION_REQUIRED",
      statusReason: available ? connection.statusReason : "PARTNER_ACCESS_REQUIRED",
      available,
      externalAccountId: connection.externalAccountId,
      lastSuccessfulSyncAt: toIsoOrNull(connection.lastSuccessfulSyncAt),
      lastFailedSyncAt: toIsoOrNull(connection.lastFailedSyncAt),
      lastErrorCode: connection.lastErrorCode,
      mappedProperties: mapped,
      recentSyncs: attempts.map((attempt) => ({
        syncType: attempt.syncType,
        status: attempt.status,
        startedAt: attempt.startedAt.toISOString(),
        completedAt: toIsoOrNull(attempt.completedAt),
        itemsProcessed: attempt.itemsProcessed,
        itemsFailed: attempt.itemsFailed,
        errorCode: attempt.errorCode,
      })),
      webhookUrl:
        provider === "HOSTAWAY"
          ? `${(this.config.get<string>("API_PUBLIC_URL") ?? "http://localhost:3001/api").replace(/\/$/, "")}/webhooks/hostaway/${connection.id}`
          : null,
    };
  }

  private async describeMappings(connectionId: string): Promise<PropertyMappingDto[]> {
    const rows = (await this.database.db.execute(sql`
      SELECT m.id::text AS id,
             m.property_id::text AS property_id,
             p.title AS property_title,
             m.external_property_id,
             m.external_property_name,
             m.status,
             (SELECT count(*)::int FROM external_reservation_mappings r
               WHERE r.connection_id = m.connection_id
                 AND r.property_id = m.property_id
                 AND r.direction = 'INBOUND'
                 AND r.status = 'ACTIVE') AS active_reservations
      FROM external_property_mappings m
      JOIN properties p ON p.id = m.property_id
      WHERE m.connection_id = ${connectionId}
      ORDER BY p.title
    `)) as unknown as Record<string, string | number | null>[];

    return rows.map((row) => ({
      id: String(row.id),
      propertyId: String(row.property_id),
      propertyTitle: String(row.property_title),
      externalPropertyId: String(row.external_property_id),
      externalPropertyName: (row.external_property_name as string | null) ?? null,
      status: String(row.status),
      activeReservations: Number(row.active_reservations ?? 0),
    }));
  }

  /**
   * Whether the same Host also imports iCal feeds.
   *
   * iCal stays supported, and a Property connected both natively and by iCal is
   * a real possibility worth warning about: the same reservation would arrive
   * twice, as an opaque busy period and as a reservation with an id. Rezervio
   * does not switch either off on its own — that is the Host's call
   * (milestone 12 §31).
   */
  private async hasIcalCalendars(hostId: string): Promise<boolean> {
    const [row] = (await this.database.db.execute(sql`
      SELECT count(*)::int AS total
      FROM external_calendars c
      JOIN properties p ON p.id = c.property_id
      WHERE p.host_id = ${hostId} AND c.status = 'ACTIVE'
    `)) as unknown as { total: number }[];

    return (row?.total ?? 0) > 0;
  }
}
