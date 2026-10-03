import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, sql } from "drizzle-orm";

import { AppError, AppErrorCode } from "../../common/app-error";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  adminActions,
  bookingSettlements,
  externalCalendars,
  notificationDeliveries,
  refunds,
  type AdminActionTarget,
  type AdminActionType,
  type NotificationType,
} from "../../infrastructure/database/schema";
import { currentRequestId } from "../../infrastructure/security/request-context";
import { redactValue } from "../../infrastructure/security/redaction";
import { CalendarSyncWorker } from "../calendars/calendar-sync.worker";
import { NotificationWorker } from "../notifications/application/notification.worker";
import { HostPaymentsService } from "../payments/host-payments.service";
import { PaymentsService } from "../payments/payments.service";
import { SettlementWorker } from "../settlements/settlement.worker";
import { ConnectionsService } from "../connectivity/application/connections.service";
import { ExternalSyncWorker } from "../connectivity/application/external-sync.worker";
import { InventorySyncService } from "../connectivity/application/inventory-sync.service";
import { OutboundReservationsService } from "../connectivity/application/outbound-reservations.service";
import { AdminJobsService } from "./admin-jobs.service";
import { PaymentProviderError } from "../payments/domain/payment-provider";
import type { AdminActionResultDto, ReconcileScope } from "./dto/admin-actions.dto";

/**
 * A stable code for the audit row.
 *
 * "UNEXPECTED" against a provider refusal would be a lie: the operation did
 * exactly what it was asked and Stripe said no. The audit is the record of
 * what happened, so it has to distinguish the two (milestone 11 §11, §15).
 */
function codeOf(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof PaymentProviderError) {
    return `${AppErrorCode.PAYMENT_PROVIDER_ERROR}:${error.code ?? "UNKNOWN"}`;
  }
  return (error as { status?: number }).status === 404 ? "NOT_FOUND" : "UNEXPECTED";
}

type ActionOutcome = {
  summary: string;
  details?: Record<string, unknown>;
};

/**
 * Everything an operator is allowed to *do*.
 *
 * The governing rule of this milestone: an admin action runs an existing
 * domain command and nothing else. There is no method here that writes a
 * status — no "set Payment SUCCEEDED", no "set Settlement TRANSFERRED", no
 * balance edit. Support can ask the system to try again; it cannot tell the
 * system what happened (milestone 11 §9, §56).
 *
 * Every action is wrapped by `run`, so authorization, audit and error handling
 * are structural rather than remembered per method.
 */
@Injectable()
export class AdminActionsService {
  private readonly logger = new Logger(AdminActionsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly notifications: NotificationWorker,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementWorker,
    private readonly calendars: CalendarSyncWorker,
    private readonly connect: HostPaymentsService,
    private readonly connections: ConnectionsService,
    private readonly integrationSync: InventorySyncService,
    private readonly outbound: OutboundReservationsService,
    private readonly externalJobs: ExternalSyncWorker,
    private readonly jobs: AdminJobsService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- actions

  /**
   * Re-queues a notification through the normal pipeline.
   *
   * Not a direct `send`: the job goes back on the queue the outbox pump feeds,
   * and delivery still claims the `dedup_key` row. So a notification that in
   * fact went out stays sent, and one that failed permanently is reopened
   * exactly once (milestone 11 §10, §42).
   */
  async retryNotification(adminUserId: string, notificationId: string): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "RETRY_NOTIFICATION", "NOTIFICATION", notificationId, async () => {
      const [delivery] = await this.database.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, notificationId))
        .limit(1);

      if (!delivery) throw new NotFoundException("Nie znaleziono powiadomienia.");

      if (delivery.status === "SENT") {
        return { summary: "Powiadomienie było już wysłane — nic nie zrobiono." };
      }

      /*
       * A FAILED row is a closed door: claiming it is what grants the right to
       * send, and a closed row will never be claimed again. Reopening it to
       * PENDING is the whole of the retry — the pipeline does the rest, with
       * its own dedup still in force.
       */
      await this.database.db
        .update(notificationDeliveries)
        .set({ status: "PENDING", lastErrorCode: null, updatedAt: new Date() })
        .where(eq(notificationDeliveries.id, notificationId));

      /*
       * `requeue`, not `enqueue`: the job id for this notification has already
       * been used, and BullMQ would treat a second `add` as a no-op. The
       * delivery row's unique dedup key is still what decides that the email
       * goes out at most once.
       */
      await this.notifications.requeue(
        delivery.bookingId,
        delivery.type as NotificationType,
        null,
      );

      return {
        summary: "Powiadomienie wróciło do kolejki.",
        details: { type: delivery.type, attempts: delivery.attemptCount },
      };
    });
  }

  /**
   * Carries out a Refund that is already recorded.
   *
   * The decision to refund was made by the domain and lives in the `refunds`
   * row; this only asks the provider again. The provider call carries the same
   * idempotency key derived from the Refund id, so a double click cannot send
   * money back twice (milestone 11 §10).
   */
  async retryRefund(adminUserId: string, refundId: string): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "RETRY_REFUND", "REFUND", refundId, async () => {
      const [refund] = await this.database.db
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .limit(1);

      if (!refund) throw new NotFoundException("Nie znaleziono zwrotu.");
      if (refund.status === "SUCCEEDED") {
        return { summary: "Zwrot był już wykonany — nic nie zrobiono." };
      }

      const result = await this.payments.processRefund(refundId);

      if (result.status === "FAILED") {
        throw new AppError(
          AppErrorCode.REFUND_FAILED,
          "Dostawca odrzucił zwrot. Szczegóły są w logach.",
          HttpStatus.CONFLICT,
        );
      }

      return { summary: `Zwrot: ${result.status}.`, details: { status: result.status } };
    });
  }

  /**
   * Runs the transfer command for one Settlement.
   *
   * Exactly the command the release job runs. The claim is still a row
   * transition to `PROCESSING`, the partial unique index still allows one live
   * Transfer per Settlement, and the provider still sees a stable idempotency
   * key — so pressing the button twice pays the Host once (milestone 11 §10).
   */
  async retryTransfer(adminUserId: string, settlementId: string): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "RETRY_TRANSFER", "SETTLEMENT", settlementId, async () => {
      const [settlement] = await this.database.db
        .select()
        .from(bookingSettlements)
        .where(eq(bookingSettlements.id, settlementId))
        .limit(1);

      if (!settlement) throw new NotFoundException("Nie znaleziono rozliczenia.");
      if (settlement.status === "TRANSFERRED") {
        return { summary: "Środki zostały już przelane — nic nie zrobiono." };
      }

      const result = await this.settlements.runTransfer(settlementId);
      if (result.transferred) {
        return { summary: "Przelew wykonany.", details: { transferred: true } };
      }

      /*
       * A refusal is not a failure. "Host not ready" and "not yet released"
       * are the domain saying no, and saying so with a code the panel can
       * explain — rather than an error the operator has to interpret.
       */
      const reason = result.reason ?? "NOT_READY";

      // Idempotent by design: asking twice for a transfer that already
      // happened is a no-op, not an error somebody has to explain (§42).
      if (reason === "ALREADY_TRANSFERRED") {
        return { summary: "Środki zostały już przelane — nic nie zrobiono." };
      }
      if (reason === "IN_PROGRESS") {
        return { summary: "Przelew jest właśnie wykonywany — nic nie zrobiono." };
      }

      if (reason === "HOST_NOT_READY") {
        throw new AppError(
          AppErrorCode.HOST_PAYMENT_ACCOUNT_NOT_READY,
          "Konto rozliczeniowe gospodarza nie jest gotowe. Rozliczenie czeka.",
          HttpStatus.CONFLICT,
        );
      }
      if (reason === "PROVIDER_FAILED") {
        throw new AppError(
          AppErrorCode.TRANSFER_FAILED,
          "Dostawca odrzucił przelew. Rekoncyliacja spróbuje ponownie.",
          HttpStatus.CONFLICT,
        );
      }

      throw new AppError(
        AppErrorCode.SETTLEMENT_NOT_READY,
        `Rozliczenie nie jest gotowe do przelewu (${reason}).`,
        HttpStatus.CONFLICT,
      );
    });
  }

  /** Puts one calendar back on the sync queue — the same job the sweep adds. */
  async resyncCalendar(adminUserId: string, calendarId: string): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "ICAL_RESYNC", "EXTERNAL_CALENDAR", calendarId, async () => {
      const [calendar] = await this.database.db
        .select()
        .from(externalCalendars)
        .where(eq(externalCalendars.id, calendarId))
        .limit(1);

      if (!calendar) throw new NotFoundException("Nie znaleziono kalendarza.");

      const outcome = await this.calendars.enqueue(calendarId, true);

      /*
       * A sync already on its way is not a failure and not a second job. The
       * summary says which happened, because "nothing visibly changed for
       * thirty seconds" is otherwise indistinguishable from a broken button.
       */
      return {
        summary: outcome.queued
          ? "Kalendarz wrócił do kolejki synchronizacji."
          : `Synchronizacja jest już zaplanowana (${outcome.pendingState ?? "w toku"}) — nie dodano drugiej.`,
        details: {
          provider: calendar.provider,
          failures: calendar.consecutiveFailures,
          queued: outcome.queued,
        },
      };
    });
  }

  /** Asks the provider what state a Host's connected account is really in. */
  async refreshConnect(adminUserId: string, hostId: string): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "REFRESH_CONNECT_STATUS", "HOST", hostId, async () => {
      const status = await this.connect.refreshStatus(hostId);
      return {
        summary: `Gotowość konta: ${status.readiness}.`,
        details: { readiness: status.readiness },
      };
    });
  }

  /**
   * The reconciliation sweep, on demand.
   *
   * One command whatever the scope: `financial-reconciliation` already walks
   * settlements, transfers, reversals and payouts in one pass, and splitting
   * it per scope would mean four code paths that must agree about ordering.
   * The scope is recorded so the audit says what was asked for
   * (milestone 11 §34).
   */
  async reconcile(adminUserId: string, scope: ReconcileScope): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "RECONCILE", "PLATFORM", scope, async () => {
      const result = await this.settlements.reconcile();

      return {
        summary:
          `Zwolnione: ${result.released}, przelewy uzgodnione: ${result.transfersRepaired}, ` +
          `ponowione: ${result.transfersRetried}, cofnięcia: ${result.reversalsRetried}, ` +
          `wypłaty: ${result.payoutsObserved}.`,
        details: { scope, ...result },
      };
    });
  }

  /**
   * Puts one failed BullMQ job back on its queue.
   *
   * Refused for anything that is not actually failed: re-running an active job
   * would duplicate work the queue is already doing, and re-running a
   * completed one would repeat an effect (milestone 11 §10).
   */
  async retryJob(
    adminUserId: string,
    queue: string,
    jobId: string,
  ): Promise<AdminActionResultDto> {
    return this.run(adminUserId, "RETRY_JOB", "JOB", `${queue}:${jobId}`, async () => {
      const result = await this.jobs.retry(queue, jobId);

      if (!result.retried) {
        throw new AppError(
          AppErrorCode.JOB_NOT_RETRYABLE,
          `Zadanie nie nadaje się do ponowienia (${result.reason ?? "UNKNOWN"}).`,
          HttpStatus.CONFLICT,
        );
      }

      return { summary: "Zadanie wróciło do kolejki.", details: { queue } };
    });
  }

  // ------------------------------------------------------- connectivity

  /**
   * Re-queues a connection's inbound sync.
   *
   * The same job the periodic sweep adds and the Host's own "Sync now" adds.
   * Support asks the system to try again; it does not write a provider state
   * (milestone 12 §26).
   */
  async retryIntegrationSync(
    adminUserId: string,
    connectionId: string,
  ): Promise<AdminActionResultDto> {
    return this.run(
      adminUserId,
      "RETRY_INTEGRATION_SYNC",
      "CONNECTION",
      connectionId,
      async () => {
        const connection = await this.requireConnection(connectionId);
        const outcome = await this.externalJobs.enqueueSync(connection.id);

        return {
          summary: outcome.queued
            ? "Synchronizacja wróciła do kolejki."
            : "Synchronizacja jest już zaplanowana — nie dodano drugiej.",
          details: { provider: connection.provider, queued: outcome.queued },
        };
      },
    );
  }

  /**
   * Runs the reconciliation pass for one connection, inline.
   *
   * Inline rather than queued because the operator is watching and the answer
   * — how many reservations were checked, how many dates freed — is the point
   * of pressing it.
   */
  async reconcileIntegration(
    adminUserId: string,
    connectionId: string,
  ): Promise<AdminActionResultDto> {
    return this.run(
      adminUserId,
      "RECONCILE_INTEGRATION",
      "CONNECTION",
      connectionId,
      async () => {
        const connection = await this.requireConnection(connectionId);
        const result = await this.integrationSync.reconcileConnection(connection);

        return {
          summary:
            `Sprawdzone: ${result.processed}, zaktualizowane: ${result.updated}, ` +
            `zwolnione: ${result.cancelled}, konflikty: ${result.conflicts}, ` +
            `błędy: ${result.failed}.`,
          details: { provider: connection.provider, ...result },
        };
      },
    );
  }

  /**
   * Switches a connection off.
   *
   * Mappings and blocks are deliberately kept: they describe reservations that
   * still exist at the provider, and removing them would free dates somebody
   * has already sold (milestone 12 §15).
   */
  async disableIntegration(
    adminUserId: string,
    connectionId: string,
  ): Promise<AdminActionResultDto> {
    return this.run(
      adminUserId,
      "DISABLE_INTEGRATION",
      "CONNECTION",
      connectionId,
      async () => {
        const connection = await this.requireConnection(connectionId);
        await this.connections.disable(connection.id, "DISABLED_BY_ADMIN");

        return {
          summary: "Połączenie wyłączone. Mapowania i blokady zostały zachowane.",
          details: { provider: connection.provider },
        };
      },
    );
  }

  /**
   * Retries an outbound push that never landed.
   *
   * The claim on the reservation mapping still applies, so this cannot create
   * a second reservation at the provider however many times it is pressed
   * (milestone 12 §14).
   */
  async retryOutboundReservation(
    adminUserId: string,
    bookingId: string,
  ): Promise<AdminActionResultDto> {
    return this.run(
      adminUserId,
      "RETRY_OUTBOUND_RESERVATION",
      "BOOKING",
      bookingId,
      async () => {
        const outcomes = await this.outbound.pushBooking(bookingId);
        const pushed = outcomes.filter((outcome) => outcome.pushed).length;

        if (pushed === 0) {
          const reason = outcomes[0] && !outcomes[0].pushed ? outcomes[0].reason : "UNKNOWN";
          throw new AppError(
            AppErrorCode.OUTBOUND_SYNC_FAILED,
            `Nie udało się przekazać rezerwacji (${reason}).`,
            HttpStatus.CONFLICT,
          );
        }

        return {
          summary: `Rezerwacja przekazana do ${pushed} systemu/ów.`,
          details: { pushed },
        };
      },
    );
  }

  private async requireConnection(connectionId: string) {
    const connection = await this.connections.byId(connectionId);
    if (!connection) throw new NotFoundException("Nie znaleziono połączenia.");
    return connection;
  }

  // ------------------------------------------------------------------ audit

  /**
   * Writes the audit row, runs the action, closes the row.
   *
   * The row is written **before** the work, so an action that crashes the
   * process still leaves a trace that somebody asked for it. The metadata is
   * scrubbed on the way in: this table must never become the one place a
   * provider secret ended up (milestone 11 §11, §25).
   */
  private async run(
    adminUserId: string,
    actionType: AdminActionType,
    targetType: AdminActionTarget,
    targetId: string,
    work: () => Promise<ActionOutcome>,
  ): Promise<AdminActionResultDto> {
    const [row] = await this.database.db
      .insert(adminActions)
      .values({ adminUserId, actionType, targetType, targetId, status: "STARTED" })
      .returning({ id: adminActions.id });

    const started = Date.now();

    try {
      const outcome = await work();
      const details = (redactValue(outcome.details ?? {}) as Record<string, unknown>) ?? {};

      await this.database.db
        .update(adminActions)
        .set({
          status: "SUCCEEDED",
          completedAt: new Date(),
          metadataJson: JSON.stringify({ summary: outcome.summary, ...details }),
        })
        .where(eq(adminActions.id, row.id));

      this.logger.log({
        event: "admin.action",
        requestId: currentRequestId(),
        actionId: row.id,
        actionType,
        targetType,
        targetId,
        status: "SUCCEEDED",
        durationMs: Date.now() - started,
      });

      return {
        actionId: row.id,
        actionType,
        status: "SUCCEEDED",
        summary: outcome.summary,
        details,
      };
    } catch (error) {
      // The code, never the provider's own message: that is what would carry
      // a payload into a table an operator can read.
      const code = codeOf(error);

      await this.database.db
        .update(adminActions)
        .set({
          status: "FAILED",
          completedAt: new Date(),
          metadataJson: JSON.stringify({ summary: `Nie powiodło się: ${code}`, code }),
        })
        .where(eq(adminActions.id, row.id));

      this.logger.warn({
        event: "admin.action",
        requestId: currentRequestId(),
        actionId: row.id,
        actionType,
        targetType,
        targetId,
        status: "FAILED",
        code,
      });

      throw error;
    }
  }

  /** How many issues reconciliation has left unexplained. Shown beside its result. */
  async openMismatches(): Promise<number> {
    const [row] = (await this.database.db.execute(sql`
      SELECT (
        (SELECT count(*) FROM host_transfers WHERE status = 'FAILED') +
        (SELECT count(*) FROM host_transfer_reversals WHERE status = 'FAILED') +
        (SELECT count(*) FROM booking_settlements WHERE status = 'FAILED') +
        (SELECT count(*) FROM refunds WHERE status = 'FAILED')
      )::int AS total
    `)) as unknown as { total: number }[];

    return row?.total ?? 0;
  }

  get reconcileIntervalMinutes(): number {
    return Number(this.config.get("SETTLEMENT_RECONCILE_MINUTES") ?? 15);
  }
}
