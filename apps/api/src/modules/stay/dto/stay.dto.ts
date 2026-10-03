import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

import { STAY_PHASES } from "../../../domain/stay";

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** How far ahead a Host may schedule; anything else is a typo, not a choice. */
export const SEND_OFFSET_CHOICES = [24, 48, 72] as const;
export const REVEAL_OFFSET_CHOICES = [6, 12, 24] as const;

const TEXT = 4000;

export class UpdateStayInformationDto {
  @ApiProperty({ example: "15:00", description: "Godzina lokalna obiektu, nie UTC" })
  @Matches(TIME, { message: "checkInTime musi mieć format HH:MM" })
  checkInTime!: string;

  @ApiProperty({ example: "11:00" })
  @Matches(TIME, { message: "checkOutTime musi mieć format HH:MM" })
  checkOutTime!: string;

  @ApiPropertyOptional({ maxLength: TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  arrivalInstructions?: string;

  @ApiPropertyOptional({ maxLength: TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  parkingInstructions?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  wifiName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  wifiPassword?: string;

  @ApiPropertyOptional({ maxLength: TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  houseRules?: string;

  @ApiPropertyOptional({ maxLength: TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  departureInstructions?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContact?: string;

  @ApiProperty({ enum: SEND_OFFSET_CHOICES, example: 24 })
  @IsInt()
  @IsIn([...SEND_OFFSET_CHOICES])
  instructionsSendOffsetHours!: number;
}

export class StayInformationDto extends UpdateStayInformationDto {
  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty({ example: "Europe/Warsaw" })
  timeZone!: string;

  @ApiProperty({ description: "Czy gospodarz zapisał już te informacje" })
  configured!: boolean;
}

export class UpdateSensitiveAccessDto {
  @ApiPropertyOptional({ maxLength: TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  accessInstructions?: string;

  @ApiPropertyOptional({ maxLength: 120, description: "Kod do drzwi albo keyboxa" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accessCode?: string;

  @ApiPropertyOptional({ maxLength: 400 })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  keyboxLocation?: string;

  @ApiProperty({ enum: REVEAL_OFFSET_CHOICES, example: 6 })
  @IsInt()
  @IsIn([...REVEAL_OFFSET_CHOICES])
  revealOffsetHours!: number;
}

/**
 * The Host's own view. A Host may read back what they typed — it is their
 * Property — but the values still travel encrypted at rest.
 */
export class SensitiveAccessDto extends UpdateSensitiveAccessDto {
  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty({ description: "Czy cokolwiek zostało zapisane" })
  configured!: boolean;
}

/**
 * What a Guest is told about the access details.
 *
 * Before the reveal instant this carries no fragment of the secret — not a
 * masked code, not a length. The frontend is never the thing hiding it
 * (milestone 09 §9, §16).
 */
export class GuestSensitiveAccessDto {
  @ApiProperty({ description: "Czy gospodarz w ogóle skonfigurował dane dostępu" })
  configured!: boolean;

  @ApiProperty({ description: "Czy dane są już dostępne dla gościa" })
  available!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Kiedy dane zostaną udostępnione; null, gdy już są albo gdy ich nie ma",
  })
  revealAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  accessCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  accessInstructions!: string | null;

  @ApiProperty({ type: String, nullable: true })
  keyboxLocation!: string | null;

  @ApiProperty({
    description: "Czy gospodarz udostępnił dane ręcznie przed czasem",
  })
  revealedManually!: boolean;
}

/** Everything a Guest needs for this Stay, in one response. */
export class StayDetailsDto {
  @ApiProperty({ example: "RZV-7KD2M9QP" })
  reference!: string;

  @ApiProperty({ example: "Baltic Loft" })
  propertyTitle!: string;

  @ApiProperty({ example: "Europe/Warsaw" })
  timeZone!: string;

  @ApiProperty({ example: "2026-09-12" })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-18" })
  checkOut!: string;

  @ApiProperty({ example: "15:00" })
  checkInTime!: string;

  @ApiProperty({ example: "11:00" })
  checkOutTime!: string;

  @ApiProperty({ example: "2026-09-12T13:00:00.000Z" })
  checkInAt!: string;

  @ApiProperty({ example: "2026-09-18T09:00:00.000Z" })
  checkOutAt!: string;

  @ApiProperty({
    enum: STAY_PHASES,
    description: "Wyliczane z dat i strefy obiektu — gość niczego nie potwierdza",
  })
  phase!: string;

  @ApiProperty({ type: String, nullable: true })
  arrivalInstructions!: string | null;

  @ApiProperty({ type: String, nullable: true })
  parkingInstructions!: string | null;

  @ApiProperty({ type: String, nullable: true })
  wifiName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  wifiPassword!: string | null;

  @ApiProperty({ type: String, nullable: true })
  houseRules!: string | null;

  @ApiProperty({ type: String, nullable: true })
  departureInstructions!: string | null;

  @ApiProperty({ type: String, nullable: true })
  emergencyContact!: string | null;

  @ApiProperty({ type: GuestSensitiveAccessDto })
  access!: GuestSensitiveAccessDto;
}

/** The Host's view of one Booking's access timing, for the manual reveal. */
export class BookingAccessStatusDto {
  @ApiProperty({ format: "uuid" })
  bookingId!: string;

  @ApiProperty({ description: "Czy obiekt ma skonfigurowane dane dostępu" })
  configured!: boolean;

  @ApiProperty({ description: "Czy gość widzi je już teraz" })
  available!: boolean;

  @ApiProperty({ type: String, nullable: true, description: "Termin wynikający z ustawień obiektu" })
  scheduledRevealAt!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Kiedy gospodarz udostępnił ręcznie" })
  manualRevealAt!: string | null;

  @ApiProperty({ example: 6, description: "Domyślny offset obiektu — ręczne udostępnienie go nie zmienia" })
  revealOffsetHours!: number;
}
