import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

export const SORT_OPTIONS = [
  "RECOMMENDED",
  "LOWEST_PRICE",
  "HIGHEST_RATING",
  "CLOSEST_TO_BEACH",
  "BEST_VALUE",
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const PROPERTY_TYPE_VALUES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO"] as const;

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === "true" || value === "1";

const toUpperList = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean);
};

/**
 * Every parameter is validated here — the API never assumes the frontend sent
 * something sane. Invalid input is a 400, not a surprising result set.
 */
export class SearchQueryDto {
  @ApiPropertyOptional({ example: "Gdańsk", description: "Miasto, dzielnica lub fragment nazwy" })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional({ example: "2026-09-12", description: "Data przyjazdu (YYYY-MM-DD)" })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "checkIn musi mieć format YYYY-MM-DD" })
  checkIn?: string;

  @ApiPropertyOptional({ example: "2026-09-16", description: "Data wyjazdu (YYYY-MM-DD)" })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "checkOut musi mieć format YYYY-MM-DD" })
  checkOut?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({
    enum: PROPERTY_TYPE_VALUES,
    isArray: true,
    description: "Lista rozdzielona przecinkami, np. VILLA,HOUSE",
  })
  @IsOptional()
  @Transform(toUpperList)
  @IsArray()
  @IsIn(PROPERTY_TYPE_VALUES as unknown as string[], { each: true })
  propertyType?: string[];

  @ApiPropertyOptional({ description: "Skrót na amenity POOL" })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  pool?: boolean;

  @ApiPropertyOptional({ description: "Skrót na amenity PARKING" })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  parking?: boolean;

  @ApiPropertyOptional({
    example: "SEA_VIEW,SAUNA",
    description: "Kody Amenity rozdzielone przecinkami; wymagane wszystkie",
  })
  @IsOptional()
  @Transform(toUpperList)
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    example: 250000,
    description:
      "Maksymalna cena CAŁKOWITA pobytu w minor units (Total Price First), nie cena za noc",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    example: 500,
    description: 'Maksymalna odległość do plaży w metrach; Property bez tej informacji są odfiltrowane',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxBeachDistanceMeters?: number;

  @ApiPropertyOptional({ example: 9, minimum: 0, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  minRating?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, description: "Minimalna liczba sypialni" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minBedrooms?: number;

  @ApiPropertyOptional({ enum: SORT_OPTIONS, default: "RECOMMENDED" })
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).toUpperCase() : undefined))
  @IsIn(SORT_OPTIONS as unknown as string[])
  sort?: SortOption;

  @ApiPropertyOptional({ description: "Północna granica viewportu mapy" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  north?: number;

  @ApiPropertyOptional({ description: "Południowa granica viewportu mapy" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  south?: number;

  @ApiPropertyOptional({ description: "Wschodnia granica viewportu mapy" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  east?: number;

  @ApiPropertyOptional({ description: "Zachodnia granica viewportu mapy" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  west?: number;

  @ApiPropertyOptional({ example: 100, default: 100, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
