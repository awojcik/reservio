import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Operational issues are a **query**, not a table.
 *
 * A hand-maintained incident list is a second source of truth: it goes stale
 * the moment somebody fixes the underlying row and forgets to close the entry.
 * Everything here is derived from the same tables the domain writes, so an
 * issue disappears exactly when the thing it describes is fixed
 * (milestone 11 §12).
 */
export const ISSUE_CATEGORIES = [
  "PAYMENT",
  "REFUND",
  "SETTLEMENT",
  "TRANSFER",
  "PAYOUT",
  "ICAL",
  "NOTIFICATION",
  "JOB",
  "WEBHOOK",
  /** Connectivity with an external PMS or channel manager (milestone 12 §25). */
  "INTEGRATION",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/**
 * Four visual states and no more, so a screen full of them stays readable
 * (milestone 11 §37).
 */
export const ISSUE_SEVERITIES = ["OK", "PENDING", "WARNING", "FAILED"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_TYPES = [
  "PAYMENT_SUCCEEDED_BOOKING_NOT_CONFIRMED",
  "PAYMENT_STUCK_OPEN",
  "REFUND_FAILED",
  "REFUND_PENDING_TOO_LONG",
  "SETTLEMENT_STUCK_PENDING",
  "SETTLEMENT_AVAILABLE_HOST_NOT_READY",
  "SETTLEMENT_FAILED",
  "TRANSFER_FAILED",
  "TRANSFER_PENDING_TOO_LONG",
  "REVERSAL_FAILED",
  "PAYOUT_FAILED",
  "ICAL_SYNC_FAILED",
  "ICAL_SYNC_STALE",
  "NOTIFICATION_FAILED",
  "OUTBOX_STUCK",
  "JOB_FAILED",
  "WEBHOOK_UNPROCESSED",
  "OUTBOUND_SYNC_FAILED",
  "INTEGRATION_SYNC_FAILED",
  "INTEGRATION_ACTION_REQUIRED",
  "EXTERNAL_RESERVATION_CONFLICT",
  "PROVIDER_EVENT_UNPROCESSED",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export class OperationalIssueDto {
  @ApiProperty({ enum: ISSUE_TYPES })
  type!: IssueType;

  @ApiProperty({ enum: ISSUE_CATEGORIES })
  category!: IssueCategory;

  @ApiProperty({ enum: ISSUE_SEVERITIES })
  severity!: IssueSeverity;

  @ApiProperty({ description: "Encja, której dotyczy problem" })
  targetId!: string;

  @ApiProperty({
    description:
      "Identyfikator, którego wymaga komenda naprawcza. Zwykle ten sam co targetId — ale ponowienie przelewu przyjmuje rozliczenie, nie przelew.",
  })
  actionTargetId!: string;

  @ApiProperty({ example: "Przelew do gospodarza nie powiódł się" })
  title!: string;

  @ApiProperty({
    example: "RZV-7K2M9 · 1 710,00 PLN",
    description: "Kontekst bez danych wrażliwych i bez surowego payloadu dostawcy.",
  })
  description!: string;

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  bookingId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bookingReference!: string | null;

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  hostId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Kod błędu domenowy albo dostawcy — nigdy jego pełna odpowiedź.",
  })
  errorCode!: string | null;

  @ApiProperty({ example: "2026-09-05T10:15:00.000Z" })
  occurredAt!: string;

  @ApiProperty({
    type: [String],
    description: "Bezpieczne akcje dostępne dla tego problemu.",
  })
  actions!: string[];
}

export class OperationalIssuesQueryDto {
  @ApiProperty({ required: false, enum: ISSUE_CATEGORIES })
  @IsOptional()
  @IsIn(ISSUE_CATEGORIES as unknown as string[])
  category?: IssueCategory;

  @ApiProperty({ required: false, enum: ISSUE_SEVERITIES })
  @IsOptional()
  @IsIn(ISSUE_SEVERITIES as unknown as string[])
  severity?: IssueSeverity;

  @ApiProperty({ required: false, default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class IssueCountDto {
  @ApiProperty({ enum: ISSUE_CATEGORIES })
  category!: IssueCategory;

  @ApiProperty()
  total!: number;

  @ApiProperty({ description: "Ile z nich to twarde awarie, a nie oczekiwanie." })
  failed!: number;
}

export class OperationalIssuesPageDto {
  @ApiProperty({ type: [OperationalIssueDto] })
  items!: OperationalIssueDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: [IssueCountDto] })
  counts!: IssueCountDto[];
}

/** One BullMQ queue, summarised. */
export class JobQueueDto {
  @ApiProperty({ example: "notifications" })
  name!: string;

  @ApiProperty({
    type: [String],
    description: "Typy zadań obsługiwane przez tę kolejkę — rejestr, nie odczyt z Redisa.",
  })
  jobTypes!: string[];

  @ApiProperty()
  waiting!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  delayed!: number;

  @ApiProperty()
  completed!: number;

  @ApiProperty()
  failed!: number;

  @ApiProperty({ description: "Czy kolejka odpowiedziała — Redis bywa niedostępny." })
  reachable!: boolean;
}

export class FailedJobDto {
  @ApiProperty({ example: "notifications" })
  queue!: string;

  @ApiProperty({ example: "3178" })
  id!: string;

  @ApiProperty({ example: "send" })
  name!: string;

  @ApiProperty()
  attemptsMade!: number;

  @ApiProperty({ type: String, nullable: true })
  failedReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failedAt!: string | null;

  @ApiProperty({
    description: "Identyfikatory z payloadu zadania. Payload nigdy nie wozi danych gościa.",
    type: Object,
  })
  data!: Record<string, unknown>;
}

export class JobsResponseDto {
  @ApiProperty({ type: [JobQueueDto] })
  queues!: JobQueueDto[];

  @ApiProperty({ type: [FailedJobDto] })
  failed!: FailedJobDto[];
}

export class NotificationIssueDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  bookingId!: string;

  @ApiProperty()
  bookingReference!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: ["GUEST", "HOST"] })
  recipientType!: string;

  @ApiProperty({
    description: "Adres zamaskowany — support widzi domenę, nie skrzynkę gościa.",
    example: "a***@example.com",
  })
  recipientMasked!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty({ type: String, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sentAt!: string | null;

  @ApiProperty()
  updatedAt!: string;
}

export class NotificationsPageDto {
  @ApiProperty({ type: [NotificationIssueDto] })
  items!: NotificationIssueDto[];

  @ApiProperty()
  total!: number;
}

export class CalendarSyncRowDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty()
  propertyTitle!: string;

  @ApiProperty({ format: "uuid" })
  hostId!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ enum: ISSUE_SEVERITIES })
  health!: IssueSeverity;

  @ApiProperty({ type: String, nullable: true })
  lastSyncSucceededAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastSyncFailedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty()
  consecutiveFailures!: number;
}

export class CalendarSyncPageDto {
  @ApiProperty({ type: [CalendarSyncRowDto] })
  items!: CalendarSyncRowDto[];

  @ApiProperty()
  total!: number;
}

/** What the last reconciliation run did, as recorded in the audit table. */
export class ReconciliationStatusDto {
  @ApiProperty({ type: String, nullable: true })
  lastRunAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastRunBy!: string | null;

  @ApiProperty({ type: String, nullable: true, enum: ["STARTED", "SUCCEEDED", "FAILED"] })
  lastRunStatus!: string | null;

  @ApiProperty({ description: "Rozliczenia zwolnione w ostatnim przebiegu" })
  released!: number;

  @ApiProperty({ description: "Przelewy uzgodnione ze stanem u dostawcy" })
  transfersRepaired!: number;

  @ApiProperty({ description: "Przelewy ponowione" })
  transfersRetried!: number;

  @ApiProperty({ description: "Cofnięcia przelewów ponowione" })
  reversalsRetried!: number;

  @ApiProperty({ description: "Wypłaty odczytane od dostawcy" })
  payoutsObserved!: number;

  @ApiProperty({
    description: "Rozbieżności, których rekoncyliacja nie umiała wyjaśnić — wciąż widoczne.",
  })
  openMismatches!: number;

  @ApiProperty({ description: "Automatyczny przebieg co tyle minut" })
  intervalMinutes!: number;
}
