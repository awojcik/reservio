import { randomBytes } from "node:crypto";

import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import { AppError, AppErrorCode } from "../../../common/app-error";
import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database, Executor } from "../../../infrastructure/database/connection";
import {
  externalInventoryConnections,
  externalPropertyMappings,
  externalSyncAttempts,
  type ConnectionStatus,
  type ConnectionStatusReason,
  type ExternalInventoryConnectionRow,
  type ExternalProvider,
  type SyncType,
} from "../../../infrastructure/database/schema";
import { PartnerAccessRequiredError, ProviderError } from "../domain/provider-errors";
import type { ProviderCredentials } from "../domain/inventory-provider";
import { ProviderCredentialsCipher } from "../infrastructure/credentials.cipher";

/**
 * Connections, their state, and their credentials.
 *
 * Every read is scoped by `hostId`. Cross-Host isolation here is not a filter
 * added at the controller: a Host who names another Host's connection gets a
 * 404, the same shape they would get for one that does not exist, so the
 * response cannot be used to discover that it does (milestone 12 §38).
 */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly credentials: ProviderCredentialsCipher,
  ) {}

  /**
   * Creates or re-arms a Host's connection to one provider.
   *
   * Idempotent by the unique key on (host_id, provider): reconnecting replaces
   * the credentials on the existing row rather than opening a second
   * connection, which would leave two answers to "which listing is this?".
   */
  async upsert(input: {
    hostId: string;
    provider: ExternalProvider;
    credentials?: ProviderCredentials;
    externalAccountId?: string | null;
    status: ConnectionStatus;
    statusReason?: ConnectionStatusReason | null;
    configuration?: Record<string, string>;
  }): Promise<ExternalInventoryConnectionRow> {
    const values = {
      hostId: input.hostId,
      provider: input.provider,
      status: input.status,
      statusReason: input.statusReason ?? null,
      externalAccountId: input.externalAccountId ?? null,
      ...(input.credentials
        ? { credentialsEncrypted: this.credentials.encrypt(input.credentials) }
        : {}),
      ...(input.configuration
        ? { configurationJson: JSON.stringify(input.configuration) }
        : {}),
      disabledAt: null,
      updatedAt: new Date(),
    };

    const [row] = await this.database.db
      .insert(externalInventoryConnections)
      .values(values)
      .onConflictDoUpdate({
        target: [externalInventoryConnections.hostId, externalInventoryConnections.provider],
        set: values,
      })
      .returning();

    // The account id is not a secret; the credentials never appear in a log.
    this.logger.log({
      event: "connectivity.connection_upserted",
      hostId: input.hostId,
      provider: input.provider,
      status: input.status,
    });

    return row;
  }

  async listForHost(hostId: string): Promise<ExternalInventoryConnectionRow[]> {
    return this.database.db
      .select()
      .from(externalInventoryConnections)
      .where(eq(externalInventoryConnections.hostId, hostId))
      .orderBy(externalInventoryConnections.provider);
  }

  /** 404 for another Host's connection — never 403, which would confirm it exists. */
  async ownedById(hostId: string, id: string): Promise<ExternalInventoryConnectionRow> {
    const [row] = await this.database.db
      .select()
      .from(externalInventoryConnections)
      .where(
        and(
          eq(externalInventoryConnections.id, id),
          eq(externalInventoryConnections.hostId, hostId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException("Nie znaleziono połączenia.");
    return row;
  }

  async byId(id: string): Promise<ExternalInventoryConnectionRow | null> {
    const [row] = await this.database.db
      .select()
      .from(externalInventoryConnections)
      .where(eq(externalInventoryConnections.id, id))
      .limit(1);

    return row ?? null;
  }

  async byProviderAndHost(
    hostId: string,
    provider: ExternalProvider,
  ): Promise<ExternalInventoryConnectionRow | null> {
    const [row] = await this.database.db
      .select()
      .from(externalInventoryConnections)
      .where(
        and(
          eq(externalInventoryConnections.hostId, hostId),
          eq(externalInventoryConnections.provider, provider),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /**
   * The credentials, decrypted, for the adapter about to use them.
   *
   * The only place ciphertext becomes plaintext. Everything that needs a
   * provider call goes through here so there is one path to audit rather than
   * one per call site.
   */
  credentialsFor(connection: ExternalInventoryConnectionRow): ProviderCredentials {
    if (!connection.credentialsEncrypted) {
      throw new AppError(
        AppErrorCode.INTEGRATION_NOT_CONNECTED,
        "Połączenie nie ma zapisanych danych dostępowych.",
        HttpStatus.CONFLICT,
      );
    }

    return this.credentials.decrypt(connection.credentialsEncrypted);
  }

  /**
   * A connection that may actually be used.
   *
   * A DEGRADED connection still is: the last sync failed, but the credentials
   * work and the next attempt may well succeed. DISCONNECTED and
   * ACTION_REQUIRED are not — one was switched off, the other is waiting on
   * something outside Rezervio.
   */
  assertUsable(connection: ExternalInventoryConnectionRow): void {
    if (connection.status === "CONNECTED" || connection.status === "DEGRADED") return;

    throw new AppError(
      connection.statusReason === "PARTNER_ACCESS_REQUIRED"
        ? AppErrorCode.PARTNER_ACCESS_REQUIRED
        : AppErrorCode.INTEGRATION_NOT_CONNECTED,
      `Połączenie ${connection.provider} nie jest gotowe (${connection.status}).`,
      HttpStatus.CONFLICT,
    );
  }

  /** Records the outcome of a sync on the connection itself. */
  async recordOutcome(
    connectionId: string,
    outcome: { ok: true } | { ok: false; errorCode: string; fatal?: boolean },
  ): Promise<void> {
    if (outcome.ok) {
      await this.database.db
        .update(externalInventoryConnections)
        .set({
          status: "CONNECTED",
          statusReason: null,
          lastSuccessfulSyncAt: new Date(),
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(externalInventoryConnections.id, connectionId));
      return;
    }

    /*
     * A failed sync degrades a connection; it does not disconnect it. Losing
     * the credentials because a provider had a bad minute would turn a blip
     * into a Host having to reconnect by hand (milestone 12 §30).
     */
    await this.database.db
      .update(externalInventoryConnections)
      .set({
        status: outcome.fatal ? "ACTION_REQUIRED" : "DEGRADED",
        statusReason: outcome.fatal ? "CREDENTIALS_REJECTED" : null,
        lastFailedSyncAt: new Date(),
        lastErrorCode: outcome.errorCode,
        updatedAt: new Date(),
      })
      .where(eq(externalInventoryConnections.id, connectionId));
  }

  /** Switches a connection off without losing what it mapped. */
  async disable(
    connectionId: string,
    reason: ConnectionStatusReason,
  ): Promise<ExternalInventoryConnectionRow> {
    const [row] = await this.database.db
      .update(externalInventoryConnections)
      .set({
        status: "DISCONNECTED",
        statusReason: reason,
        disabledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(externalInventoryConnections.id, connectionId))
      .returning();

    if (!row) throw new NotFoundException("Nie znaleziono połączenia.");

    this.logger.log({ event: "connectivity.connection_disabled", connectionId, reason });
    return row;
  }

  // ------------------------------------------------------------ sync audit

  /**
   * Opens a sync attempt row.
   *
   * Written before the work, so an attempt that takes the process down with it
   * still leaves the evidence that it started (milestone 12 §7).
   */
  async startAttempt(connectionId: string, syncType: SyncType): Promise<string> {
    const [row] = await this.database.db
      .insert(externalSyncAttempts)
      .values({ connectionId, syncType, status: "RUNNING" })
      .returning({ id: externalSyncAttempts.id });

    return row.id;
  }

  async finishAttempt(
    attemptId: string,
    result: { processed: number; failed: number; errorCode?: string | null },
  ): Promise<void> {
    await this.database.db
      .update(externalSyncAttempts)
      .set({
        status: result.errorCode ? "FAILED" : "SUCCEEDED",
        completedAt: new Date(),
        itemsProcessed: result.processed,
        itemsFailed: result.failed,
        errorCode: result.errorCode ?? null,
      })
      .where(eq(externalSyncAttempts.id, attemptId));
  }

  async recentAttempts(connectionId: string, limit = 10) {
    return this.database.db
      .select()
      .from(externalSyncAttempts)
      .where(eq(externalSyncAttempts.connectionId, connectionId))
      .orderBy(desc(externalSyncAttempts.startedAt))
      .limit(limit);
  }

  /**
   * Runs one unit of provider work with its audit row and its status update.
   *
   * Wrapping it here rather than remembering it per call site is what keeps
   * "every sync is visible, including the ones that failed" structural
   * (milestone 12 §7, §26).
   */
  async withAttempt<T extends { processed: number; failed: number }>(
    connection: ExternalInventoryConnectionRow,
    syncType: SyncType,
    work: () => Promise<T>,
  ): Promise<T> {
    const attemptId = await this.startAttempt(connection.id, syncType);

    try {
      const result = await work();
      await this.finishAttempt(attemptId, {
        processed: result.processed,
        failed: result.failed,
      });
      await this.recordOutcome(connection.id, { ok: true });
      return result;
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "UNEXPECTED";
      const fatal =
        error instanceof PartnerAccessRequiredError ||
        (error instanceof ProviderError && !error.retryable && error.status === 401);

      await this.finishAttempt(attemptId, { processed: 0, failed: 1, errorCode: code });
      await this.recordOutcome(connection.id, { ok: false, errorCode: code, fatal });

      this.logger.warn({
        event: "connectivity.sync_failed",
        connectionId: connection.id,
        provider: connection.provider,
        syncType,
        code,
      });

      throw error;
    }
  }

  /** Mapped Property count, for the Host and admin summaries. */
  async mappedPropertyCount(connectionId: string): Promise<number> {
    const [row] = (await this.database.db.execute(sql`
      SELECT count(*)::int AS total
      FROM external_property_mappings
      WHERE connection_id = ${connectionId} AND status = 'ACTIVE'
    `)) as unknown as { total: number }[];

    return row?.total ?? 0;
  }

  /**
   * The shared secret Hostaway sends back in its webhook's basic-auth header.
   *
   * Hostaway does not sign webhooks — its contract offers a username and
   * password it will pass on the Authorization header, and nothing else. So
   * that is what Rezervio uses, with a secret it generates rather than one a
   * Host chooses (milestone 12 §28).
   */
  static newWebhookSecret(): string {
    return randomBytes(24).toString("base64url");
  }

  /** Removes every mapping of a connection. Used when a Host disconnects. */
  async clearMappings(connectionId: string, executor: Executor = this.database.db) {
    await executor
      .delete(externalPropertyMappings)
      .where(eq(externalPropertyMappings.connectionId, connectionId));
  }
}
