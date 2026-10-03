import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

import { MESSAGE_SENDER_TYPES } from "../../../infrastructure/database/schema";

export const MESSAGE_MAX_LENGTH = 4000;

export class SendMessageDto {
  @ApiProperty({
    minLength: 1,
    maxLength: MESSAGE_MAX_LENGTH,
    description: "Zwykły tekst. Nie renderujemy HTML ani Markdown.",
  })
  @IsString()
  @MinLength(1, { message: "Wiadomość nie może być pusta." })
  @MaxLength(MESSAGE_MAX_LENGTH)
  body!: string;
}

export class MessageDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: MESSAGE_SENDER_TYPES })
  senderType!: string;

  @ApiProperty({ example: "Jan Kowalski", description: "Imię autora do wyświetlenia" })
  senderName!: string;

  @ApiProperty({ description: "Czy tę wiadomość napisał odbiorca tej odpowiedzi" })
  mine!: boolean;

  @ApiProperty({ example: "Dzień dobry, o której mogę przyjechać?" })
  body!: string;

  @ApiProperty({ example: "2026-09-10T09:15:00.000Z" })
  createdAt!: string;
}

export class MessagesPageDto {
  @ApiProperty({ type: [MessageDto], description: "Od najstarszej do najnowszej w tej stronie" })
  items!: MessageDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Kursor do pobrania starszych wiadomości; null, gdy to początek rozmowy",
  })
  nextCursor!: string | null;

  @ApiProperty({ description: "Czy są jeszcze starsze wiadomości" })
  hasMore!: boolean;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({ example: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: "Kursor z poprzedniej strony — zwraca wiadomości starsze niż on",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}
