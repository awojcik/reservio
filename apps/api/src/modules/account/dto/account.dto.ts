import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { TRIP_CATEGORIES } from "../../../domain/trip-category";
import { BookingDto } from "../../bookings/dto/booking.dto";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class ProfileDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "anna@example.com", description: "Tożsamość logowania, tylko do odczytu" })
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "pl" })
  preferredLocale!: string | null;

  @ApiProperty({ type: Boolean, description: "Czy konto ma profil gospodarza" })
  isHost!: boolean;
}

/**
 * Email is absent by design: it is the login identity and changing it needs a
 * verification flow (milestone 06 §8, §47).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "Anna" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: "Kowalska" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ example: "+48 600 100 200" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: "pl", enum: ["pl", "en"] })
  @IsOptional()
  @IsIn(["pl", "en"])
  preferredLocale?: string;
}

/** A Booking as it appears in My Trips, with what a card needs to render. */
export class TripDto extends BookingDto {
  @ApiProperty({ enum: TRIP_CATEGORIES })
  category!: string;

  @ApiProperty({ type: String, nullable: true, example: "Gdańsk" })
  propertyCity!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Okładka zapisana przy rezerwacji; działa też po archiwizacji obiektu",
  })
  coverImageUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Slug obiektu, gdy wciąż jest opublikowany; null po wycofaniu",
  })
  propertySlug!: string | null;
}

export class TripsPageDto {
  @ApiProperty({ type: [TripDto] })
  items!: TripDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Kursor do kolejnej strony; null, gdy to ostatnia",
  })
  nextCursor!: string | null;
}

export class TripsQueryDto {
  @ApiPropertyOptional({ enum: TRIP_CATEGORIES })
  @IsOptional()
  @IsIn(TRIP_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: "Kursor z poprzedniej strony" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}
