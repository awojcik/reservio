import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import { AMENITY_CODES } from "../../../../domain/amenities";
import { BOOKING_MODES, PROPERTY_TYPES } from "../../../../infrastructure/database/schema";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
} from "../../../../domain/publish-readiness";

const CURRENCIES = ["PLN", "EUR", "USD", "GBP"] as const;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * `@Type(() => Number)` would turn "" into 0, so an empty field would silently
 * save as zero and only surface later as a failed publish. Anything that is not
 * a real number is passed through untouched for @IsInt to reject with a 400.
 */
const toNumber = ({ value }: { value: unknown }) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (trimmedValue === "") return value;
    const parsed = Number(trimmedValue);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

/**
 * Everything a Host may set. `hostId`, `status`, `createdAt` and `updatedAt`
 * are absent by design — status changes are explicit domain commands, and
 * ownership is never client-supplied (milestone 02 §35).
 *
 * Every field is optional: a DRAFT is saved incrementally and publish
 * completeness is checked only when publishing.
 */
export class HostAddressInputDto {
  @ApiPropertyOptional({ example: "ul. Morska 12/3" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @ApiPropertyOptional({ example: "80-001" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: "Gdańsk" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: "Brzeźno" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  district?: string;

  /**
   * A real country, not any two characters.
   *
   * `MaxLength(2)` alone accepted "PO" — what "Polska" becomes when a Host
   * types the country name into a two-character box. It stored cleanly and
   * then broke geocoding silently, because the provider filters by country
   * and no country has that code.
   */
  @ApiPropertyOptional({ example: "PL", description: "Kod ISO-3166-1 alpha-2" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @IsString()
  @IsISO31661Alpha2({ message: "countryCode musi być kodem kraju ISO-3166-1 alpha-2, np. PL." })
  countryCode?: string;

  @ApiPropertyOptional({ example: "Europe/Warsaw" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  timeZone?: string;

  @ApiPropertyOptional({ example: 54.40312 })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 18.61402 })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class HostCapacityInputDto {
  @ApiPropertyOptional({ example: 4, minimum: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(50)
  maxGuests?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(30)
  bedrooms?: number;

  @ApiPropertyOptional({ example: 3, minimum: 0 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(60)
  beds?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(30)
  bathrooms?: number;
}

export class HostPricingInputDto {
  @ApiPropertyOptional({ example: 45000, description: "DailyRate w minor units" })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  baseDailyRateAmountMinor?: number;

  @ApiPropertyOptional({ example: 10000, description: "CleaningFee w minor units" })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  cleaningFeeAmountMinor?: number;

  @ApiPropertyOptional({ enum: CURRENCIES, example: "PLN" })
  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  currency?: string;
}

export class UpdateHostPropertyDto {
  @ApiPropertyOptional({ example: "Apartament nad morzem" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ example: "Przestronny apartament…" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({ enum: PROPERTY_TYPES })
  @IsOptional()
  @IsIn(PROPERTY_TYPES as unknown as string[])
  propertyType?: string;

  @ApiPropertyOptional({ enum: BOOKING_MODES })
  @IsOptional()
  @IsIn(BOOKING_MODES as unknown as string[])
  bookingMode?: string;

  @ApiPropertyOptional({ type: HostAddressInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HostAddressInputDto)
  address?: HostAddressInputDto;

  @ApiPropertyOptional({ type: HostCapacityInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HostCapacityInputDto)
  capacity?: HostCapacityInputDto;

  @ApiPropertyOptional({ type: HostPricingInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HostPricingInputDto)
  pricing?: HostPricingInputDto;

  @ApiPropertyOptional({
    type: [String],
    enum: AMENITY_CODES,
    description: "Pełna lista kodów Amenity — zastępuje dotychczasowy zestaw",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AMENITY_CODES.length)
  @IsIn(AMENITY_CODES as unknown as string[], { each: true })
  amenities?: string[];
}

export class CreateHostPropertyDto {
  @ApiPropertyOptional({ example: "Apartament nad morzem" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ enum: PROPERTY_TYPES, default: "APARTMENT" })
  @IsOptional()
  @IsIn(PROPERTY_TYPES as unknown as string[])
  propertyType?: string;
}

export class ReorderImagesDto {
  @ApiPropertyOptional({
    type: [String],
    description: "Pełna lista identyfikatorów PropertyImage w docelowej kolejności",
  })
  @IsArray()
  @IsUUID("4", { each: true })
  imageIds!: string[];
}
