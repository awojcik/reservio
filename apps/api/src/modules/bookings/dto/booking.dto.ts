import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { PaymentStateDto } from "../../payments/dto/payment.dto";
import { Transform, Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import {
  ACTOR_TYPES,
  BOOKING_EVENT_TYPES,
  BOOKING_MODES,
  BOOKING_STATUSES,
  BOOKING_STATUS_REASONS,
} from "../../../infrastructure/database/schema";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class GuestDetailsDto {
  @ApiProperty({ example: "Jan Kowalski" })
  @Transform(trimmed)
  @IsString()
  @MinLength(2, { message: "Podaj imię i nazwisko" })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: "jan@example.com" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "Podaj poprawny adres email" })
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: "+48 600 100 200" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class CreateBookingDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: "2026-09-12" })
  @Matches(DATE, { message: "checkIn musi mieć format YYYY-MM-DD" })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-16", description: "Dzień wyjazdu (exclusive)" })
  @Matches(DATE, { message: "checkOut musi mieć format YYYY-MM-DD" })
  checkOut!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  adults!: number;

  @ApiPropertyOptional({ example: 1, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  children?: number;

  @ApiProperty({ type: GuestDetailsDto })
  @ValidateNested()
  @Type(() => GuestDetailsDto)
  guest!: GuestDetailsDto;
}

export class BookingPriceDto {
  @ApiProperty({ example: 180000 })
  accommodationAmountMinor!: number;

  @ApiProperty({ example: 12000 })
  cleaningFeeAmountMinor!: number;

  @ApiProperty({ example: 0, description: "Zarezerwowane na przyszłość" })
  serviceFeeAmountMinor!: number;

  @ApiProperty({ example: 0, description: "Zarezerwowane na przyszłość" })
  taxAmountMinor!: number;

  @ApiProperty({ example: 0, description: "Zarezerwowane na przyszłość" })
  discountAmountMinor!: number;

  @ApiProperty({ example: 192000 })
  totalAmountMinor!: number;

  @ApiProperty({ example: "PLN" })
  currency!: string;
}

export class BookingTimelineEntryDto {
  @ApiProperty({ enum: BOOKING_EVENT_TYPES })
  type!: string;

  @ApiProperty({ enum: ACTOR_TYPES })
  actorType!: string;

  @ApiProperty({ example: "2026-09-01T10:15:00.000Z" })
  createdAt!: string;
}

export class BookingActionsDto {
  @ApiProperty({
    example: true,
    description: "Czy rezerwację można jeszcze anulować. Wyliczane przez backend.",
  })
  canCancel!: boolean;

  @ApiProperty({
    example: false,
    description:
      "Czy rezerwacja jest już przypisana do konta. Anonimowa rezerwacja może zostać przypisana bezpiecznym claimem.",
  })
  claimed!: boolean;

  @ApiProperty({
    example: true,
    description:
      "Czy można rozpocząć albo ponowić płatność. Wymaga aktywnej blokady terminu — po jej wygaśnięciu ponowienie nie jest możliwe.",
  })
  canPay!: boolean;
}

/** What a Guest gets back. Deliberately free of anything Host-private. */
export class BookingDto {
  @ApiProperty({ example: "RZV-7KD2M9QP" })
  reference!: string;

  @ApiProperty({ enum: BOOKING_STATUSES })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: BOOKING_STATUS_REASONS,
    example: "HOLD_EXPIRED",
  })
  statusReason!: string | null;

  @ApiProperty({ enum: BOOKING_MODES })
  bookingMode!: string;

  @ApiProperty({ example: "Apartament nad morzem" })
  propertyTitle!: string;

  @ApiProperty({ example: "2026-09-12" })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-16" })
  checkOut!: string;

  @ApiProperty({ example: 2 })
  adults!: number;

  @ApiProperty({ example: 1 })
  children!: number;

  @ApiProperty({ type: BookingPriceDto })
  price!: BookingPriceDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "2026-09-01T10:25:00.000Z",
    description: "Kiedy wygasa blokada terminu; null, gdy rezerwacja jej nie ma",
  })
  holdExpiresAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "2026-09-02T10:15:00.000Z",
    description: "Do kiedy gospodarz może odpowiedzieć; null poza trybem prośby",
  })
  hostResponseDeadlineAt!: string | null;

  @ApiProperty({ example: "2026-09-01T10:15:00.000Z" })
  createdAt!: string;

  @ApiProperty({ type: [BookingTimelineEntryDto] })
  timeline!: BookingTimelineEntryDto[];

  @ApiProperty({ type: BookingActionsDto })
  allowedActions!: BookingActionsDto;

  @ApiProperty({
    type: PaymentStateDto,
    nullable: true,
    description: "Stan płatności; null, dopóki płatność nie została rozpoczęta",
  })
  payment!: PaymentStateDto | null;
}

/** Adds the Guest contact a Host needs in order to handle the request. */
export class HostBookingDto extends BookingDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty({ example: "Jan Kowalski" })
  guestName!: string;

  @ApiProperty({ example: "jan@example.com" })
  guestEmail!: string;

  @ApiProperty({ type: String, nullable: true })
  guestPhone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  hostRespondedAt!: string | null;
}

export class GuestAccessDto {
  @ApiProperty({ description: "Token z linku w emailu. Wymieniany na cookie sesji gościa." })
  @IsString()
  @MaxLength(500)
  token!: string;
}

export const HOST_BOOKING_SORTS = [
  "NEWEST",
  "STAY_DATE_ASC",
  "STAY_DATE_DESC",
  "ACTION_REQUIRED",
] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class HostBookingsQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({
    example: "RZV-7KD2M9QP",
    description: "Szuka po numerze rezerwacji, imieniu gościa albo adresie email",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: "2026-09-01", description: "Pobyty kończące się od tej daty" })
  @IsOptional()
  @Matches(DATE_ONLY, { message: "from musi mieć format YYYY-MM-DD" })
  from?: string;

  @ApiPropertyOptional({ example: "2026-10-01", description: "Pobyty zaczynające się przed tą datą" })
  @IsOptional()
  @Matches(DATE_ONLY, { message: "to musi mieć format YYYY-MM-DD" })
  to?: string;

  @ApiPropertyOptional({ enum: HOST_BOOKING_SORTS, default: "NEWEST" })
  @IsOptional()
  @IsIn(HOST_BOOKING_SORTS as unknown as string[])
  sort?: string;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class HostBookingsPageDto {
  @ApiProperty({ type: [HostBookingDto] })
  items!: HostBookingDto[];

  @ApiProperty({ example: 42, description: "Liczba wszystkich pasujących rezerwacji" })
  total!: number;

  @ApiProperty({ example: true })
  hasMore!: boolean;
}
