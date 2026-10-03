import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import { MIN_PASSWORD_LENGTH } from "../password.service";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const normalisedEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

/**
 * General sign-up. Creates a User and nothing else — becoming a Host is a
 * separate, optional step (milestone 06 §31).
 */
export class RegisterDto {
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

  @ApiProperty({ example: "anna@example.com" })
  @Transform(normalisedEmail)
  @IsEmail({}, { message: "Podaj poprawny adres email" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "bardzo-bezpieczne-haslo", minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`,
  })
  @MaxLength(200)
  password!: string;
}

/** Sign-up that also opens a Host profile, used by the Host onboarding page. */
export class RegisterHostDto extends RegisterDto {
  @ApiProperty({ example: "Anna Kowalska" })
  @Transform(trimmed)
  @IsString()
  @MinLength(2, { message: "Nazwa gospodarza musi mieć co najmniej 2 znaki" })
  @MaxLength(120)
  displayName!: string;
}

export class LoginDto {
  @ApiProperty({ example: "anna@example.com" })
  @Transform(normalisedEmail)
  @IsString()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "bardzo-bezpieczne-haslo" })
  @IsString()
  @MaxLength(200)
  password!: string;
}

export class AuthUserDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "anna@example.com", description: "Tożsamość logowania" })
  email!: string;

  @ApiProperty({ type: String, nullable: true, example: "Anna" })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Kowalska" })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "+48 600 100 200" })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "pl" })
  preferredLocale!: string | null;
}

export class AuthHostDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Anna Kowalska" })
  displayName!: string;
}

export class AuthSessionDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({
    type: AuthHostDto,
    nullable: true,
    description: "Profil Host; null dla User, który nie jest jeszcze gospodarzem",
  })
  host!: AuthHostDto | null;
}
