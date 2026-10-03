import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { AdminGuard, CurrentUser } from "../auth/auth.guards";
import type { SessionUser } from "../auth/sessions.service";
import { AdminActionsService } from "./admin-actions.service";
import {
  AdminActionResultDto,
  IcalResyncDto,
  IntegrationActionDto,
  RetryOutboundDto,
  ReconcileDto,
  RefreshConnectDto,
  RetryJobDto,
  RetryNotificationDto,
  RetryRefundDto,
  RetryTransferDto,
} from "./dto/admin-actions.dto";

/**
 * The only things support may *do*.
 *
 * Every route below runs an existing domain command. There is deliberately no
 * endpoint that writes a status: no "confirm this Booking", no "mark this
 * Payment succeeded", no "mark this Settlement transferred", no balance edit.
 * A tool that can reach a state the domain cannot reach is a tool for creating
 * incidents (milestone 11 §9, §56).
 *
 * Each action is authorised by the same guard as the reads, audited by
 * `AdminActionsService`, and idempotent because the command underneath it is.
 */
@ApiTags("admin")
@ApiCookieAuth()
@ApiForbiddenResponse({ description: "ADMIN_FORBIDDEN" })
@UseGuards(AdminGuard, RateLimitGuard)
@RateLimit({ bucket: "admin-action", limit: 60, windowSeconds: 300, scope: "user" })
@Controller("admin/actions")
export class AdminActionsController {
  constructor(private readonly actions: AdminActionsService) {}

  @Post("retry-notification")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów powiadomienie",
    description:
      "Wraca do zwykłej kolejki powiadomień. Klucz deduplikacji nadal obowiązuje, więc wysłane powiadomienie nie zostanie wysłane drugi raz.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  @ApiNotFoundResponse({ description: "Nie znaleziono powiadomienia" })
  retryNotification(
    @CurrentUser() admin: SessionUser,
    @Body() dto: RetryNotificationDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.retryNotification(admin.id, dto.notificationId);
  }

  @Post("retry-refund")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów zwrot",
    description:
      "Wykonuje zapisaną wcześniej decyzję o zwrocie. Klucz idempotency u dostawcy pochodzi z identyfikatora zwrotu, więc pieniądze nie wrócą dwa razy.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  @ApiConflictResponse({ description: "REFUND_FAILED" })
  retryRefund(
    @CurrentUser() admin: SessionUser,
    @Body() dto: RetryRefundDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.retryRefund(admin.id, dto.refundId);
  }

  @Post("retry-transfer")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów przelew do gospodarza",
    description:
      "Ta sama komenda, którą wykonuje zadanie po zwolnieniu środków. Częściowy unikalny indeks nadal dopuszcza jeden żywy przelew na rozliczenie.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  @ApiConflictResponse({
    description: "SETTLEMENT_NOT_READY / HOST_PAYMENT_ACCOUNT_NOT_READY / TRANSFER_FAILED",
  })
  retryTransfer(
    @CurrentUser() admin: SessionUser,
    @Body() dto: RetryTransferDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.retryTransfer(admin.id, dto.settlementId);
  }

  @Post("ical-resync")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów synchronizację kalendarza",
    description: "Dodaje to samo zadanie, co okresowy sweep. Deduplikowane po identyfikatorze.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  resyncCalendar(
    @CurrentUser() admin: SessionUser,
    @Body() dto: IcalResyncDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.resyncCalendar(admin.id, dto.externalCalendarId);
  }

  @Post("refresh-connect")
  @HttpCode(200)
  @ApiOperation({
    summary: "Odśwież stan konta Connect",
    description:
      "Pyta dostawcę o rzeczywisty stan konta gospodarza. Rezervio nie przechowuje danych KYC ani numerów kont.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  refreshConnect(
    @CurrentUser() admin: SessionUser,
    @Body() dto: RefreshConnectDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.refreshConnect(admin.id, dto.hostId);
  }

  @Post("reconcile")
  @HttpCode(200)
  @ApiOperation({
    summary: "Uruchom rekoncyliację",
    description:
      "Ten sam przebieg, który chodzi automatycznie: zwalnia należne rozliczenia, dopytuje dostawcę o zawieszone przelewy, ponawia nieudane i odczytuje wypłaty.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  reconcile(
    @CurrentUser() admin: SessionUser,
    @Body() dto: ReconcileDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.reconcile(admin.id, dto.scope);
  }

  /**
   * Re-queues one failed BullMQ job.
   *
   * Audited like everything else, and refused for a job that is not actually
   * failed — re-running an active job would duplicate work the queue is
   * already doing.
   */
  @Post("retry-integration-sync")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów synchronizację integracji",
    description:
      "To samo zadanie, które dodaje okresowy sweep i przycisk gospodarza. Deduplikowane po identyfikatorze połączenia.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  retryIntegrationSync(
    @CurrentUser() admin: SessionUser,
    @Body() dto: IntegrationActionDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.retryIntegrationSync(admin.id, dto.connectionId);
  }

  @Post("reconcile-integration")
  @HttpCode(200)
  @ApiOperation({
    summary: "Uzgodnij integrację ze stanem u dostawcy",
    description:
      "Porównuje aktywne rezerwacje zewnętrzne z tym, co dostawca mówi teraz, i zwalnia terminy po anulowaniach, których webhook nie dotarł.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  reconcileIntegration(
    @CurrentUser() admin: SessionUser,
    @Body() dto: IntegrationActionDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.reconcileIntegration(admin.id, dto.connectionId);
  }

  @Post("disable-integration")
  @HttpCode(200)
  @ApiOperation({
    summary: "Wyłącz integrację",
    description:
      "Zatrzymuje synchronizację. Mapowania i blokady zostają — opisują rezerwacje, które nadal istnieją u dostawcy.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  disableIntegration(
    @CurrentUser() admin: SessionUser,
    @Body() dto: IntegrationActionDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.disableIntegration(admin.id, dto.connectionId);
  }

  @Post("retry-outbound-reservation")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów przekazanie rezerwacji do systemu gospodarza",
    description:
      "Ta sama komenda, którą wykonuje zadanie po potwierdzeniu rezerwacji. Roszczenie na mapowaniu nadal obowiązuje, więc nie powstanie druga rezerwacja u dostawcy.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  @ApiConflictResponse({ description: "OUTBOUND_SYNC_FAILED" })
  retryOutbound(
    @CurrentUser() admin: SessionUser,
    @Body() dto: RetryOutboundDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.retryOutboundReservation(admin.id, dto.bookingId);
  }

  @Post("retry-job")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ponów nieudane zadanie",
    description:
      "BullMQ ponawia to samo zadanie z tym samym payloadem. Idempotencję zapewniają te same mechanizmy, co przy pierwszym uruchomieniu.",
  })
  @ApiOkResponse({ type: AdminActionResultDto })
  @ApiConflictResponse({ description: "JOB_NOT_RETRYABLE" })
  retryJob(
    @CurrentUser() admin: SessionUser,
    @Body() dto: RetryJobDto,
  ): Promise<AdminActionResultDto> {
    return this.actions.retryJob(admin.id, dto.queue, dto.jobId);
  }
}
