import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from "class-validator";

import { AVAILABILITY_SOURCE_TYPES } from "../../../infrastructure/database/schema";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class HostAllCalendarQueryDto {
  @ApiProperty({ example: "2026-09-01" })
  @Matches(DATE, { message: "from musi mieć format YYYY-MM-DD" })
  from!: string;

  @ApiProperty({ example: "2026-10-01", description: "Exclusive" })
  @Matches(DATE, { message: "to musi mieć format YYYY-MM-DD" })
  to!: string;

  @ApiPropertyOptional({ format: "uuid", description: "Zawęża widok do jednego obiektu" })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ example: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class HostAllCalendarEventDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: AVAILABILITY_SOURCE_TYPES })
  type!: string;

  @ApiProperty({ example: "2026-09-12" })
  startDate!: string;

  @ApiProperty({ example: "2026-09-16", description: "Exclusive" })
  endDate!: string;

  @ApiProperty({ example: "Rezerwacja", description: "Etykieta dla człowieka, nie enum" })
  label!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Skąd pochodzi blokada, np. nazwa kalendarza zewnętrznego",
  })
  sourceLabel!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "RZV-7KD2M9QP" })
  bookingReference!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Imię gościa; zawsze null dla kalendarzy zewnętrznych, żeby nie ujawniać danych z cudzego feedu",
  })
  guestName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Kiedy wygasa tymczasowa blokada",
  })
  expiresAt!: string | null;
}

export class HostAllCalendarPropertyDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Baltic Loft" })
  title!: string;

  @ApiProperty({ example: "PUBLISHED" })
  status!: string;

  @ApiProperty({ example: "Europe/Warsaw" })
  timeZone!: string;

  @ApiProperty({ type: [HostAllCalendarEventDto] })
  events!: HostAllCalendarEventDto[];
}

export class HostAllCalendarDto {
  @ApiProperty({ example: "2026-09-01" })
  from!: string;

  @ApiProperty({ example: "2026-10-01" })
  to!: string;

  @ApiProperty({ type: [HostAllCalendarPropertyDto] })
  properties!: HostAllCalendarPropertyDto[];
}
