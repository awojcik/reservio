import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

import { AdminActionRecordDto } from "./admin-views.dto";

/**
 * Safe operational actions.
 *
 * Every one of these runs an **existing domain command**. None of them writes
 * a status directly: there is no "set Payment SUCCEEDED", no "set Settlement
 * TRANSFERRED", no balance edit. A support tool that can put the database into
 * a state the domain cannot reach is a tool for creating incidents, not for
 * resolving them (milestone 11 §9, §56).
 */
export class RetryNotificationDto {
  @ApiProperty({ format: "uuid", description: "Wiersz notification_deliveries." })
  @IsUUID()
  notificationId!: string;
}

export class RetryRefundDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  refundId!: string;
}

export class RetryTransferDto {
  @ApiProperty({ format: "uuid", description: "Rozliczenie, którego przelew ma zostać ponowiony." })
  @IsUUID()
  settlementId!: string;
}

export class IcalResyncDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  externalCalendarId!: string;
}

export class RefreshConnectDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  hostId!: string;
}

export const RETRYABLE_QUEUES = [
  "calendar-sync",
  "booking-hold-expire",
  "booking-lifecycle",
  "notifications",
  "payment-refund",
  "payment-provider-cancel",
  "stay-lifecycle",
  "host-settlement",
] as const;

export class RetryJobDto {
  @ApiProperty({ enum: RETRYABLE_QUEUES })
  @IsIn(RETRYABLE_QUEUES as unknown as string[])
  queue!: string;

  @ApiProperty({ description: "Identyfikator zadania BullMQ." })
  @IsString()
  @MaxLength(200)
  jobId!: string;
}

export class IntegrationActionDto {
  @ApiProperty({ format: "uuid", description: "Połączenie z zewnętrznym PMS lub channel managerem." })
  @IsUUID()
  connectionId!: string;
}

export class RetryOutboundDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  bookingId!: string;
}

export const RECONCILE_SCOPES = ["payment", "settlement", "transfer", "payout", "all"] as const;
export type ReconcileScope = (typeof RECONCILE_SCOPES)[number];

export class ReconcileDto {
  @ApiProperty({ enum: RECONCILE_SCOPES, default: "all" })
  @IsIn(RECONCILE_SCOPES as unknown as string[])
  scope!: ReconcileScope;
}

export class AdminActionResultDto {
  @ApiProperty({ format: "uuid", description: "Wiersz audytu tej akcji." })
  actionId!: string;

  @ApiProperty()
  actionType!: string;

  @ApiProperty({ enum: ["SUCCEEDED", "FAILED"] })
  status!: string;

  @ApiProperty({
    description:
      "Co się stało — po polsku, bez sekretów i bez surowej odpowiedzi dostawcy.",
    example: "Powiadomienie wróciło do kolejki.",
  })
  summary!: string;

  @ApiProperty({
    type: Object,
    description: "Liczby, nie treść. Puste dla akcji, które nic nie zliczają.",
  })
  details!: Record<string, unknown>;
}

export class AdminActionsQueryDto {
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

export class AdminActionsPageDto {
  @ApiProperty({ type: [AdminActionRecordDto] })
  items!: AdminActionRecordDto[];

  @ApiProperty()
  total!: number;
}
