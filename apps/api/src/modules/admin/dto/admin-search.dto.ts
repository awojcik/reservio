import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";

/**
 * What one search hit points at.
 *
 * Support is given an identifier and asked what it belongs to — a Booking
 * reference read over the phone, a provider id copied out of a Stripe email, an
 * address from a complaint. The result says which entity it is and where the
 * lifecycle for it lives (milestone 11 §6).
 */
export const ADMIN_SEARCH_KINDS = [
  "BOOKING",
  "USER",
  "HOST",
  "PROPERTY",
  "PAYMENT",
  "REFUND",
  "SETTLEMENT",
  "TRANSFER",
  "PAYOUT",
] as const;
export type AdminSearchKind = (typeof ADMIN_SEARCH_KINDS)[number];

export class AdminSearchQueryDto {
  @ApiProperty({
    description:
      "Numer rezerwacji, email, nazwa obiektu albo identyfikator dowolnej encji finansowej.",
    example: "RZV-7K2M9",
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AdminSearchHitDto {
  @ApiProperty({ enum: ADMIN_SEARCH_KINDS })
  kind!: AdminSearchKind;

  @ApiProperty({ description: "Identyfikator encji, którą trafiono" })
  id!: string;

  @ApiProperty({ example: "RZV-7K2M9 · Baltic Loft" })
  label!: string;

  @ApiProperty({ example: "CONFIRMED · 12–16 września 2026" })
  description!: string;

  @ApiProperty({
    description: "Dokąd prowadzi ten wynik w panelu admina.",
    example: "/admin/bookings/…",
  })
  href!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Rezerwacja, do której należy ten wynik — jeśli jakakolwiek.",
  })
  bookingId!: string | null;
}

export class AdminSearchResponseDto {
  @ApiProperty({ type: [AdminSearchHitDto] })
  items!: AdminSearchHitDto[];

  @ApiProperty({ description: "Zapytanie po normalizacji — nigdy nie jest logowane." })
  query!: string;
}
