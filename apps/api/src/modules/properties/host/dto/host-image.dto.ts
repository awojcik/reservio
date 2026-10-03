import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_PROPERTY = 30;

export class CreateUploadUrlDto {
  @ApiProperty({ example: "living-room.jpg" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ enum: ALLOWED_IMAGE_TYPES, example: "image/jpeg" })
  @IsIn(ALLOWED_IMAGE_TYPES as unknown as string[], {
    message: "Dozwolone formaty to JPEG, PNG i WebP",
  })
  contentType!: string;

  @ApiProperty({ example: 2_450_000, maximum: MAX_IMAGE_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_BYTES, { message: "Maksymalny rozmiar zdjęcia to 10 MB" })
  sizeBytes!: number;
}

export class UploadUrlDto {
  @ApiProperty({ description: "Presigned PUT URL — traktuj jak poświadczenie" })
  uploadUrl!: string;

  @ApiProperty({ example: "properties/2b6d…/9f1c….jpg" })
  objectKey!: string;

  @ApiProperty({ example: 600 })
  expiresInSeconds!: number;
}

export class ConfirmImageDto {
  @ApiProperty({ example: "properties/2b6d…/9f1c….jpg" })
  @IsString()
  @MaxLength(300)
  objectKey!: string;

  @ApiPropertyOptional({ example: "Salon apartamentu" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(300)
  altText?: string;
}
