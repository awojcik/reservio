import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

import {
  PAYOUT_STATUSES,
  SETTLEMENT_STATUSES,
  TRANSFER_STATUSES,
} from "../../../infrastructure/database/schema";

/**
 * The Host's money, in business terms.
 *
 * Deliberately free of provider internals: a Host cares whether they will be
 * paid and when, not which object id Stripe assigned (milestone 10 §25).
 */
export class HostBalanceDto {
  @ApiProperty({ example: "PLN" })
  currency!: string;

  @ApiProperty({ example: 95000, description: "Zarobione, czeka na termin zwolnienia" })
  pendingMinor!: number;

  @ApiProperty({ example: 47500, description: "Gotowe do przekazania albo w drodze" })
  availableMinor!: number;

  @ApiProperty({ example: 190000, description: "Przekazane na konto rozliczeniowe" })
  transferredMinor!: number;

  @ApiProperty({ example: 0, description: "Anulowane po zwrocie dla gościa" })
  cancelledMinor!: number;

  @ApiProperty({ example: 0, description: "Cofnięte po zwrocie wykonanym po przekazaniu" })
  reversedMinor!: number;
}

export class SettlementDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "RZV-7KD2M9QP" })
  bookingReference!: string;

  @ApiProperty({ example: "Baltic Loft" })
  propertyTitle!: string;

  @ApiProperty({ example: "2026-09-12" })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-18" })
  checkOut!: string;

  @ApiProperty({ example: 192000, description: "Ile zapłacił gość" })
  grossAmountMinor!: number;

  @ApiProperty({ example: 9600, description: "Prowizja Rezervio ze snapshotu rezerwacji" })
  platformFeeMinor!: number;

  @ApiProperty({ example: 182400, description: "Kwota dla gospodarza" })
  hostAmountMinor!: number;

  @ApiProperty({ example: "PLN" })
  currency!: string;

  @ApiProperty({ enum: SETTLEMENT_STATUSES })
  status!: string;

  @ApiProperty({ example: "2026-09-13T13:00:00.000Z", description: "Kiedy środki się zwolnią" })
  releaseAt!: string;

  @ApiProperty({ type: String, nullable: true })
  transferredAt!: string | null;

  @ApiProperty({
    enum: TRANSFER_STATUSES,
    nullable: true,
    type: String,
    description: "Stan przekazania środków na konto rozliczeniowe",
  })
  transferStatus!: string | null;

  @ApiProperty({ description: "Czy w tym środowisku można zwolnić środki ręcznie" })
  canReleaseNow!: boolean;
}

export class SettlementsPageDto {
  @ApiProperty({ type: [SettlementDto] })
  items!: SettlementDto[];

  @ApiProperty({ example: 12 })
  total!: number;
}

export class HostPayoutDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: 182400 })
  amountMinor!: number;

  @ApiProperty({ example: "PLN" })
  currency!: string;

  @ApiProperty({ enum: PAYOUT_STATUSES })
  status!: string;

  @ApiProperty({ type: String, nullable: true, description: "Spodziewana data na koncie" })
  arrivalAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureMessage!: string | null;

  @ApiProperty({ example: "2026-09-20T10:00:00.000Z" })
  createdAt!: string;
}

/** Everything the finance screen needs, in one request. */
export class HostFinanceSummaryDto {
  @ApiProperty({ type: HostBalanceDto })
  balance!: HostBalanceDto;

  @ApiProperty({ description: "Czy konto rozliczeniowe jest gotowe do przyjmowania środków" })
  payoutsReady!: boolean;

  @ApiProperty({ example: "READY" })
  accountReadiness!: string;

  @ApiProperty({ type: [HostPayoutDto], description: "Ostatnie wypłaty na konto bankowe" })
  recentPayouts!: HostPayoutDto[];
}

export class SettlementsQueryDto {
  @ApiPropertyOptional({ example: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
