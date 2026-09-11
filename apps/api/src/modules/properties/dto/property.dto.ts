import { ApiProperty } from "@nestjs/swagger";

/**
 * The public API contract. Deliberately separate from the Drizzle rows: the
 * database may change shape without breaking clients, and no backend entity
 * leaks into the frontend.
 */

export class PriceQuoteDto {
  @ApiProperty({ example: 4, description: "Liczba nocy pobytu" })
  nights!: number;

  @ApiProperty({ example: 180000, description: "Nocleg w minor units" })
  accommodationAmountMinor!: number;

  @ApiProperty({ example: 12000, description: "Opłata za sprzątanie w minor units" })
  cleaningFeeAmountMinor!: number;

  @ApiProperty({ example: 192000, description: "Cena całkowita pobytu w minor units" })
  totalAmountMinor!: number;

  @ApiProperty({
    example: 210000,
    type: Number,
    nullable: true,
    description: "Cena referencyjna MarketPrice; null, gdy brak wiarygodnego źródła",
  })
  marketAmountMinor!: number | null;

  @ApiProperty({
    example: 18000,
    type: Number,
    nullable: true,
    description: "Oszczędność względem MarketPrice; null, gdy brak MarketPrice",
  })
  savingAmountMinor!: number | null;

  @ApiProperty({ example: "PLN", description: "Waluta ISO-4217" })
  currency!: string;
}

export class PropertyImageDto {
  @ApiProperty()
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  altText!: string | null;

  @ApiProperty({ example: 0 })
  position!: number;
}

export class PropertySummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "baltic-loft-brzezno" })
  slug!: string;

  @ApiProperty({ example: "Baltic Loft" })
  title!: string;

  @ApiProperty({ example: "Gdańsk" })
  city!: string;

  @ApiProperty({ example: "Brzeźno" })
  district!: string;

  @ApiProperty({ example: 54.40312 })
  latitude!: number;

  @ApiProperty({ example: 18.61402 })
  longitude!: number;

  @ApiProperty({ type: PropertyImageDto, nullable: true, required: false })
  coverImage!: PropertyImageDto | null;

  @ApiProperty({ example: 9.4, description: "Ocena w skali 0–10" })
  rating!: number;

  @ApiProperty({ example: 127 })
  reviewCount!: number;

  @ApiProperty({ example: 2 })
  bedrooms!: number;

  @ApiProperty({ example: 3 })
  beds!: number;

  @ApiProperty({ example: 1 })
  bathrooms!: number;

  @ApiProperty({ example: 4 })
  maxGuests!: number;

  @ApiProperty({ enum: ["APARTMENT", "HOUSE", "VILLA", "STUDIO"] })
  propertyType!: string;

  @ApiProperty({ type: [String], example: ["POOL", "PARKING"] })
  amenities!: string[];

  @ApiProperty({ example: 280, type: Number, nullable: true })
  distanceToBeachMeters!: number | null;

  @ApiProperty({ type: PriceQuoteDto })
  price!: PriceQuoteDto;
}

export class PropertyDetailDto extends PropertySummaryDto {
  @ApiProperty({ example: "Dwupoziomowy loft…" })
  description!: string;

  @ApiProperty({ type: [PropertyImageDto] })
  images!: PropertyImageDto[];

  @ApiProperty({ example: "PL" })
  countryCode!: string;

  @ApiProperty({ example: "Europe/Warsaw" })
  timeZone!: string;

  @ApiProperty({ example: 45000, description: "Stawka za noc w minor units" })
  baseDailyRateAmountMinor!: number;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      "Czy Property jest wolne w podanym Stay. null, gdy nie podano checkIn i checkOut.",
  })
  available!: boolean | null;

  @ApiProperty({
    enum: ["REQUEST_TO_BOOK", "INSTANT_BOOK"],
    description:
      "Czy rezerwacja wymaga akceptacji gospodarza. Gość musi to wiedzieć przed wysłaniem formularza.",
  })
  bookingMode!: string;

  /*
   * The only part of the stay information that is public. Instructions, Wi-Fi
   * and anything resembling access details stay behind a Booking
   * (milestone 09 §42).
   */
  @ApiProperty({ example: "15:00", description: "Zameldowanie od, czas lokalny obiektu" })
  checkInTime!: string;

  @ApiProperty({ example: "11:00", description: "Wymeldowanie do, czas lokalny obiektu" })
  checkOutTime!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Zasady domu — jedyny publiczny fragment informacji o pobycie",
  })
  houseRules!: string | null;
}

export class SearchResponseDto {
  @ApiProperty({ type: [PropertySummaryDto] })
  items!: PropertySummaryDto[];

  @ApiProperty({ example: 18, description: "Liczba wszystkich pasujących Property" })
  total!: number;
}
