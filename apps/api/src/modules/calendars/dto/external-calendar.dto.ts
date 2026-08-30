import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import {
  EXTERNAL_CALENDAR_PROVIDERS,
  EXTERNAL_CALENDAR_STATUSES,
} from "../../../infrastructure/database/schema";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateExternalCalendarDto {
  @ApiProperty({ enum: EXTERNAL_CALENDAR_PROVIDERS, example: "AIRBNB" })
  @IsIn(EXTERNAL_CALENDAR_PROVIDERS as unknown as string[])
  provider!: string;

  @ApiProperty({ example: "Airbnb — apartament nad morzem" })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: "https://www.airbnb.com/calendar/ical/12345.ics?s=secret",
    description:
      "Adres feedu iCal. Traktowany jak sekret: szyfrowany w bazie i nigdy nie zwracany w całości.",
  })
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  importUrl!: string;
}

export class UpdateExternalCalendarDto {
  @ApiPropertyOptional({ example: "Booking.com — studio" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: EXTERNAL_CALENDAR_STATUSES })
  @IsOptional()
  @IsIn(EXTERNAL_CALENDAR_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ description: "Nowy adres feedu; zastępuje poprzedni" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  importUrl?: string;
}

export class ExternalCalendarDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: EXTERNAL_CALENDAR_PROVIDERS })
  provider!: string;

  @ApiProperty({ example: "Airbnb — apartament nad morzem" })
  name!: string;

  @ApiProperty({
    example: "https://www.airbnb.com/…/1234…",
    description: "Zamaskowany adres. Pełny URL nie opuszcza backendu.",
  })
  maskedUrl!: string;

  @ApiProperty({ enum: EXTERNAL_CALENDAR_STATUSES })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: "2026-09-01T10:15:00.000Z" })
  lastSyncSucceededAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastSyncFailedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "TIMEOUT" })
  lastErrorCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorMessage!: string | null;

  @ApiProperty({ example: 0 })
  consecutiveFailures!: number;

  @ApiProperty({ example: 4, description: "Liczba terminów zaimportowanych z tego kalendarza" })
  importedBlockCount!: number;
}

export class CalendarExportTokenDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: "http://localhost:3001/api/calendar/ical/abc….ics",
    description: "Pełny adres zwracany wyłącznie przy tworzeniu lub rotacji tokenu.",
  })
  url!: string | null;

  @ApiProperty({ example: "2026-09-01T10:15:00.000Z" })
  createdAt!: string;
}

export class CalendarExportStatusDto {
  @ApiProperty({ example: true, description: "Czy istnieje aktywny token eksportu" })
  active!: boolean;

  @ApiProperty({ type: String, nullable: true })
  createdAt!: string | null;
}
