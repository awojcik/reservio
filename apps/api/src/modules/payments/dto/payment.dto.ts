import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import {
  HOST_PAYMENT_READINESS,
  PAYMENT_STATUSES,
} from "../../../infrastructure/database/schema";

/**
 * What the browser needs to render Stripe Elements — and nothing else.
 *
 * The amount is echoed for display only; the authoritative figure lives in the
 * Booking snapshot and the PaymentIntent that was created from it
 * (milestone 08 §9).
 */
export class PaymentIntentDto {
  @ApiProperty({ format: "uuid" })
  paymentId!: string;

  @ApiProperty({
    description:
      "Sekret potrzebny do potwierdzenia płatności w przeglądarce. Nie jest logowany ani przechowywany.",
  })
  clientSecret!: string;

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status!: string;

  @ApiProperty({ example: 192000 })
  amountMinor!: number;

  @ApiProperty({ example: "PLN" })
  currency!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Do kiedy termin jest zablokowany",
  })
  expiresAt!: string | null;
}

/** The money side of a Booking, as the Guest sees it. */
export class PaymentStateDto {
  @ApiProperty({ enum: PAYMENT_STATUSES, nullable: true, type: String })
  status!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Komunikat od dostawcy płatności, jeśli płatność się nie powiodła",
  })
  failureMessage!: string | null;

  @ApiProperty({ description: "Czy dla tej płatności zlecono zwrot" })
  refunded!: boolean;
}

export class WebhookAckDto {
  @ApiProperty({ example: true })
  received!: boolean;

  @ApiPropertyOptional({
    description: "Zdarzenie było już przetworzone — nie wywołało drugiego efektu",
  })
  duplicate?: boolean;
}

export class HostPaymentStatusDto {
  @ApiProperty({ example: "STRIPE" })
  provider!: string;

  @ApiProperty({ enum: HOST_PAYMENT_READINESS })
  readiness!: string;

  @ApiProperty()
  chargesEnabled!: boolean;

  @ApiProperty()
  payoutsEnabled!: boolean;

  @ApiProperty()
  detailsSubmitted!: boolean;

  @ApiProperty({ description: "Czy konto rozliczeniowe w ogóle istnieje" })
  connected!: boolean;
}

export class OnboardingLinkDto {
  @ApiProperty({ description: "Adres konfiguracji po stronie dostawcy" })
  url!: string;

  @ApiProperty({ example: "2026-09-01T10:15:00.000Z" })
  expiresAt!: string;
}
