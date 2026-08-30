import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import {
  BOOKING_MODES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
} from "../../../../infrastructure/database/schema";
import { PUBLISH_REQUIREMENTS } from "../../../../domain/publish-readiness";

/**
 * The Host-facing contract. Separate from the public Listing DTO on purpose:
 * it exposes the private address and the publish state, neither of which a
 * Guest may ever see (milestone 02 §29).
 */

export class HostPropertyImageDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "http://localhost:9000/rezervio-local/properties/…/a.jpg" })
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  altText!: string | null;

  @ApiProperty({ example: 0, description: "position = 0 oznacza zdjęcie główne" })
  position!: number;
}

export class HostPropertyAddressDto {
  @ApiProperty({ type: String, nullable: true, example: "ul. Morska 12/3" })
  addressLine1!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "80-001" })
  postalCode!: string | null;

  @ApiProperty({ example: "Gdańsk" })
  city!: string;

  @ApiProperty({ example: "Brzeźno" })
  district!: string;

  @ApiProperty({ example: "PL" })
  countryCode!: string;

  @ApiProperty({ example: "Europe/Warsaw" })
  timeZone!: string;

  @ApiProperty({ type: Number, nullable: true, example: 54.40312 })
  latitude!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 18.61402 })
  longitude!: number | null;
}

export class HostPropertyCapacityDto {
  @ApiProperty({ example: 4 })
  maxGuests!: number;

  @ApiProperty({ example: 2 })
  bedrooms!: number;

  @ApiProperty({ example: 3 })
  beds!: number;

  @ApiProperty({ example: 1 })
  bathrooms!: number;
}

export class HostPropertyPricingDto {
  @ApiProperty({ example: 45000, description: "DailyRate w minor units" })
  baseDailyRateAmountMinor!: number;

  @ApiProperty({ example: 10000, description: "CleaningFee w minor units" })
  cleaningFeeAmountMinor!: number;

  @ApiProperty({ example: "PLN", enum: ["PLN", "EUR", "USD", "GBP"] })
  currency!: string;
}

export class PublishReadinessDto {
  @ApiProperty({ example: false })
  ready!: boolean;

  @ApiProperty({
    isArray: true,
    enum: PUBLISH_REQUIREMENTS,
    example: ["DESCRIPTION", "LOCATION", "MINIMUM_IMAGES"],
  })
  missing!: string[];
}

export class HostPropertySummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "apartament-nad-morzem-gdansk" })
  slug!: string;

  @ApiProperty({ enum: PROPERTY_STATUSES })
  status!: string;

  @ApiProperty({ example: "Apartament nad morzem" })
  title!: string;

  @ApiProperty({ example: "Gdańsk" })
  city!: string;

  @ApiProperty({ type: HostPropertyImageDto, nullable: true })
  coverImage!: HostPropertyImageDto | null;

  @ApiProperty({ type: HostPropertyPricingDto })
  pricing!: HostPropertyPricingDto;

  @ApiProperty({ example: "2026-08-28T18:00:00.000Z" })
  updatedAt!: string;

  @ApiProperty({ type: PublishReadinessDto })
  publishReadiness!: PublishReadinessDto;
}

export class HostPropertyDetailDto extends HostPropertySummaryDto {
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: PROPERTY_TYPES })
  propertyType!: string;

  @ApiProperty({
    enum: BOOKING_MODES,
    description:
      "REQUEST_TO_BOOK wymaga akceptacji gospodarza; INSTANT_BOOK rezerwuje od razu.",
  })
  bookingMode!: string;

  @ApiProperty({ type: HostPropertyAddressDto })
  address!: HostPropertyAddressDto;

  @ApiProperty({ type: HostPropertyCapacityDto })
  capacity!: HostPropertyCapacityDto;

  @ApiProperty({ type: [String], example: ["WIFI", "PARKING"] })
  amenities!: string[];

  @ApiProperty({ type: [HostPropertyImageDto] })
  images!: HostPropertyImageDto[];
}

export class PublishErrorDto {
  @ApiProperty({ example: "images" })
  field!: string;

  @ApiProperty({ example: "MINIMUM_IMAGES_REQUIRED" })
  code!: string;

  @ApiPropertyOptional({ example: 3 })
  required?: number;
}

export class PropertyNotReadyDto {
  @ApiProperty({ example: "PROPERTY_NOT_READY_FOR_PUBLISH" })
  code!: string;

  @ApiProperty({ type: [PublishErrorDto] })
  errors!: PublishErrorDto[];
}
