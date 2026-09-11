import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import { GEOCODE_PRECISIONS } from "../domain/geocoding-provider";

export class GeocodeRequestDto {
  @ApiProperty({ required: false, example: "ul. Jelitkowska 1" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @ApiProperty({ required: false, example: "80-342" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiProperty({ example: "Gdańsk" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city!: string;

  @ApiProperty({ required: false, example: "Jelitkowo" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  /**
   * Rejected rather than passed through when it is not a country: the provider
   * filters by country code, so a made-up one turns every lookup into a silent
   * "address not found" instead of an error anybody can act on.
   */
  @ApiProperty({ example: "PL" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @IsString()
  @IsISO31661Alpha2({ message: "countryCode musi być kodem kraju ISO-3166-1 alpha-2, np. PL." })
  countryCode!: string;

  @ApiProperty({
    required: false,
    description:
      "Pomija cache i pyta dostawcę ponownie. Dla jawnego „znajdź z adresu” — sens tego przycisku polega na niezgodzie z poprzednią odpowiedzią.",
  })
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class GeocodeResponseDto {
  @ApiProperty({ description: "False, gdy adres istnieje, ale dostawca go nie zna." })
  found!: boolean;

  @ApiProperty({ type: Number, nullable: true, example: 54.4264 })
  latitude!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 18.5923 })
  longitude!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: GEOCODE_PRECISIONS,
    description:
      "EXACT to numer budynku, STREET ulica, CITY samo miasto. Poniżej STREET znacznik trzeba poprawić ręcznie.",
  })
  precision!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Co dostawca uważa, że znalazł — do porównania przez gospodarza.",
  })
  formattedAddress!: string | null;
}
