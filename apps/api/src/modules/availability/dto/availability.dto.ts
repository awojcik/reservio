import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

import { AVAILABILITY_SOURCE_TYPES } from "../../../infrastructure/database/schema";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class DateRangeDto {
  @ApiProperty({ example: "2026-09-12", description: "Pierwszy dzień zakresu (inclusive)" })
  @Matches(DATE, { message: "startDate musi mieć format YYYY-MM-DD" })
  startDate!: string;

  @ApiProperty({
    example: "2026-09-16",
    description: "Dzień po ostatnim zablokowanym (exclusive)",
  })
  @Matches(DATE, { message: "endDate musi mieć format YYYY-MM-DD" })
  endDate!: string;
}

export class BlockDatesDto extends DateRangeDto {
  @ApiPropertyOptional({ example: "Wyjazd właściciela", description: "Notatka prywatna Host" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UnblockDatesDto extends DateRangeDto {}

export class CalendarWindowDto {
  @ApiProperty({ example: "2026-09-01" })
  @Matches(DATE, { message: "from musi mieć format YYYY-MM-DD" })
  from!: string;

  @ApiProperty({ example: "2026-11-01" })
  @Matches(DATE, { message: "to musi mieć format YYYY-MM-DD" })
  to!: string;
}

export class HostCalendarBlockDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "2026-09-12" })
  startDate!: string;

  @ApiProperty({ example: "2026-09-16", description: "Exclusive" })
  endDate!: string;

  @ApiProperty({ enum: AVAILABILITY_SOURCE_TYPES })
  sourceType!: string;

  @ApiProperty({ example: "Ręczna blokada" })
  sourceLabel!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Nazwa kalendarza zewnętrznego; null dla blokad ręcznych",
  })
  calendarName!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Notatka prywatna Host" })
  note!: string | null;
}

export class HostCalendarDto {
  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty({ example: "2026-09-01" })
  from!: string;

  @ApiProperty({ example: "2026-11-01" })
  to!: string;

  @ApiProperty({ type: [HostCalendarBlockDto] })
  blocks!: HostCalendarBlockDto[];
}

export class UnavailableRangeDto {
  @ApiProperty({ example: "2026-09-12" })
  startDate!: string;

  @ApiProperty({ example: "2026-09-16", description: "Exclusive" })
  endDate!: string;
}

export class PublicAvailabilityDto {
  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty({ example: "2026-09-01" })
  from!: string;

  @ApiProperty({ example: "2026-10-01" })
  to!: string;

  @ApiProperty({
    type: [UnavailableRangeDto],
    description:
      "Zajęte terminy. Źródło blokady, notatki i błędy synchronizacji nie są ujawniane.",
  })
  unavailableRanges!: UnavailableRangeDto[];
}
