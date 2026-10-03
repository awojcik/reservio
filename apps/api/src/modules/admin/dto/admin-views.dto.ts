import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

import { IssueCountDto, OperationalIssueDto } from "./admin-operations.dto";

/**
 * The Booking lifecycle, end to end.
 *
 * The whole point of the screen is that Payment, Refund, Settlement, Transfer
 * and Payout are five different things and a support question is usually
 * "which one of them stopped". Putting them in one response is what lets
 * somebody answer that without opening five tabs (milestone 11 §7).
 */
export class AdminPaymentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  amountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  platformFeeAmountMinor!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Identyfikator u dostawcy. Jawny identyfikator, nie sekret.",
  })
  providerPaymentId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  succeededAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class AdminRefundDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  amountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  providerRefundId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class AdminTransferDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  amountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  providerTransferId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class AdminSettlementDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  grossAmountMinor!: number;

  @ApiProperty()
  platformFeeMinor!: number;

  @ApiProperty()
  hostAmountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  releaseAt!: string;

  @ApiProperty({ type: String, nullable: true })
  transferredAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiProperty({ type: [AdminTransferDto] })
  transfers!: AdminTransferDto[];
}

export class AdminPayoutDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  amountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  arrivalAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class AdminNotificationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  recipientType!: string;

  @ApiProperty({ description: "Adres zamaskowany.", example: "a***@example.com" })
  recipientMasked!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty({ type: String, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sentAt!: string | null;
}

export class AdminBookingEventDto {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  actorType!: string;

  @ApiProperty()
  createdAt!: string;
}

export class AdminAvailabilityLinkDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "BOOKING" })
  source!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty({ type: String, nullable: true })
  holdStatus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  holdExpiresAt!: string | null;
}

export class AdminActionRecordDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  actionType!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ description: "Email operatora, który uruchomił akcję." })
  adminEmail!: string;

  @ApiProperty({ type: String, nullable: true, description: "Krótkie podsumowanie wyniku." })
  summary!: string | null;

  @ApiProperty({
    type: Object,
    description: "Liczby z przebiegu akcji. Nigdy sekrety ani payload dostawcy.",
  })
  details!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true })
  completedAt!: string | null;
}

export class AdminBookingDetailDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: String, nullable: true })
  statusReason!: string | null;

  @ApiProperty()
  bookingMode!: string;

  @ApiProperty()
  checkIn!: string;

  @ApiProperty()
  checkOut!: string;

  @ApiProperty()
  adults!: number;

  @ApiProperty()
  children!: number;

  @ApiProperty({ description: "Nazwisko ze snapshotu rezerwacji, nie z profilu." })
  guestName!: string;

  @ApiProperty({ description: "Adres zamaskowany.", example: "a***@example.com" })
  guestEmailMasked!: string;

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  guestUserId!: string | null;

  @ApiProperty({ format: "uuid" })
  hostId!: string;

  @ApiProperty()
  hostDisplayName!: string;

  @ApiProperty({ type: String, nullable: true })
  hostEmailMasked!: string | null;

  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty()
  propertyTitle!: string;

  @ApiProperty()
  totalAmountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: AdminPaymentDto, nullable: true })
  payment!: AdminPaymentDto | null;

  @ApiProperty({ type: [AdminRefundDto] })
  refunds!: AdminRefundDto[];

  @ApiProperty({ type: AdminSettlementDto, nullable: true })
  settlement!: AdminSettlementDto | null;

  @ApiProperty({ type: [AdminPayoutDto], description: "Wypłaty gospodarza po tym przelewie." })
  payouts!: AdminPayoutDto[];

  @ApiProperty({ type: [AdminAvailabilityLinkDto] })
  availability!: AdminAvailabilityLinkDto[];

  @ApiProperty()
  messageCount!: number;

  @ApiProperty({ type: [AdminNotificationDto] })
  notifications!: AdminNotificationDto[];

  @ApiProperty({ type: [AdminBookingEventDto] })
  events!: AdminBookingEventDto[];

  @ApiProperty({ type: [OperationalIssueDto] })
  issues!: OperationalIssueDto[];

  @ApiProperty({ type: [AdminActionRecordDto] })
  adminActions!: AdminActionRecordDto[];
}

export class AdminBookingRowDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  propertyTitle!: string;

  @ApiProperty()
  guestName!: string;

  @ApiProperty()
  checkIn!: string;

  @ApiProperty()
  checkOut!: string;

  @ApiProperty()
  totalAmountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  paymentStatus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  settlementStatus!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class AdminBookingsPageDto {
  @ApiProperty({ type: [AdminBookingRowDto] })
  items!: AdminBookingRowDto[];

  @ApiProperty()
  total!: number;
}

export class AdminBookingsQueryDto {
  @ApiProperty({ required: false, description: "Numer rezerwacji lub jego fragment." })
  @IsOptional()
  search?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false, default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminSessionSummaryDto {
  @ApiProperty()
  active!: number;

  @ApiProperty({ type: String, nullable: true })
  lastSeenAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  expiresAt!: string | null;
}

export class AdminUserDetailDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ type: [String], description: "SUPPORT / ADMIN. Puste dla zwykłego konta." })
  roles!: string[];

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  hostId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  hostDisplayName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({
    type: AdminSessionSummaryDto,
    description: "Liczba żywych sesji. Nigdy sam token ani jego hash.",
  })
  sessions!: AdminSessionSummaryDto;

  @ApiProperty({ type: [AdminBookingRowDto] })
  bookings!: AdminBookingRowDto[];
}

export class AdminHostPropertyDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  city!: string;
}

export class AdminHostDetailDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  userId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({
    enum: ["NOT_STARTED", "IN_PROGRESS", "READY", "RESTRICTED", "NONE"],
    description: "Gotowość konta Connect. Rezervio nie przechowuje danych KYC.",
  })
  connectReadiness!: string;

  @ApiProperty({ type: String, nullable: true })
  providerAccountId!: string | null;

  @ApiProperty()
  chargesEnabled!: boolean;

  @ApiProperty()
  payoutsEnabled!: boolean;

  @ApiProperty({ type: [AdminHostPropertyDto] })
  properties!: AdminHostPropertyDto[];

  @ApiProperty({ type: [AdminSettlementDto] })
  settlements!: AdminSettlementDto[];

  @ApiProperty({ type: [AdminPayoutDto] })
  payouts!: AdminPayoutDto[];

  @ApiProperty({ type: [OperationalIssueDto] })
  issues!: OperationalIssueDto[];
}

export class CalendarSyncSummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: String, nullable: true })
  lastSyncSucceededAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty()
  consecutiveFailures!: number;
}

export class AdminPropertyDetailDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  timeZone!: string;

  @ApiProperty({ format: "uuid" })
  hostId!: string;

  @ApiProperty()
  hostDisplayName!: string;

  @ApiProperty({ description: "Ile blokad dostępności obowiązuje od dziś." })
  activeBlocks!: number;

  @ApiProperty({ description: "Rezerwacje, które jeszcze się nie skończyły." })
  activeBookings!: number;

  @ApiProperty({ type: [CalendarSyncSummaryDto] })
  calendars!: CalendarSyncSummaryDto[];

  @ApiProperty({ description: "Czy StayInformation jest skonfigurowane. Nigdy jego treść." })
  stayInformationConfigured!: boolean;

  @ApiProperty({
    description:
      "Czy dane dostępu są skonfigurowane. Kod do drzwi nie opuszcza backendu — także tutaj.",
  })
  sensitiveAccessConfigured!: boolean;

  @ApiProperty({ type: [AdminBookingRowDto] })
  bookings!: AdminBookingRowDto[];
}

/**
 * One connection, as an operator needs to see it.
 *
 * No credentials — not the ciphertext, not a masked fragment. What support
 * needs is whether it works and when it last did (milestone 12 §25).
 */
export class AdminIntegrationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: ["HOSTAWAY", "CHANNEX"] })
  provider!: string;

  @ApiProperty({ format: "uuid" })
  hostId!: string;

  @ApiProperty()
  hostDisplayName!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: String, nullable: true })
  statusReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  externalAccountId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastSuccessfulSyncAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastFailedSyncAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty()
  mappedProperties!: number;

  @ApiProperty({ description: "Aktywne rezerwacje zewnętrzne blokujące kalendarz." })
  inboundReservations!: number;

  @ApiProperty({ description: "Rezerwacje Rezervio czekające na przekazanie albo nieudane." })
  pendingOutbound!: number;

  @ApiProperty({ description: "Nieudane synchronizacje w ostatniej dobie." })
  failedSyncs!: number;

  @ApiProperty({ description: "Zdarzenia dostawcy przyjęte, ale nieprzetworzone." })
  unprocessedEvents!: number;
}

export class AdminIntegrationsPageDto {
  @ApiProperty({ type: [AdminIntegrationDto] })
  items!: AdminIntegrationDto[];

  @ApiProperty()
  total!: number;
}

export class AdminStripeStatusDto {
  @ApiProperty({
    example: "TEST",
    enum: ["TEST", "UNSET"],
    description:
      "Rezervio działa wyłącznie w sandboxie. Klucz live zatrzymuje start procesu, więc LIVE nie może się tu pojawić.",
  })
  mode!: string;

  @ApiProperty({ description: "Zawsze true w tym milestone." })
  testMode!: boolean;

  @ApiProperty({ description: "Czy skonfigurowano sekret webhooka." })
  webhookConfigured!: boolean;

  @ApiProperty({ description: "Ilu gospodarzy ma konto Connect w stanie READY." })
  connectReadyHosts!: number;

  @ApiProperty()
  connectPendingHosts!: number;
}

export class FailedJobSummaryDto {
  @ApiProperty()
  queue!: string;

  @ApiProperty()
  failed!: number;

  @ApiProperty()
  reachable!: boolean;
}

export class ReconciliationStatusSummaryDto {
  @ApiProperty({ type: String, nullable: true })
  lastRunAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastRunStatus!: string | null;

  @ApiProperty()
  openMismatches!: number;

  @ApiProperty()
  intervalMinutes!: number;
}

export class AdminDashboardDto {
  @ApiProperty({ type: AdminStripeStatusDto })
  stripe!: AdminStripeStatusDto;

  @ApiProperty({ type: [IssueCountDto] })
  issueCounts!: IssueCountDto[];

  @ApiProperty({ type: [OperationalIssueDto], description: "Najpilniejsze problemy." })
  topIssues!: OperationalIssueDto[];

  @ApiProperty({ type: [AdminBookingRowDto] })
  recentBookings!: AdminBookingRowDto[];

  @ApiProperty({ type: [FailedJobSummaryDto] })
  failedJobs!: FailedJobSummaryDto[];

  @ApiProperty({ type: ReconciliationStatusSummaryDto })
  reconciliation!: ReconciliationStatusSummaryDto;

  @ApiProperty({ type: [AdminActionRecordDto] })
  recentActions!: AdminActionRecordDto[];

  @ApiProperty({
    type: [AdminIntegrationDto],
    description: "Połączenia z zewnętrznymi PMS i channel managerami.",
  })
  integrations!: AdminIntegrationDto[];
}
