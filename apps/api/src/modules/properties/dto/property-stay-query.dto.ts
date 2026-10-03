import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, Matches } from "class-validator";

export class PropertyStayQueryDto {
  @ApiPropertyOptional({ example: "2026-09-12", description: "Data przyjazdu (YYYY-MM-DD)" })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "checkIn musi mieć format YYYY-MM-DD" })
  checkIn?: string;

  @ApiPropertyOptional({ example: "2026-09-16", description: "Data wyjazdu (YYYY-MM-DD)" })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "checkOut musi mieć format YYYY-MM-DD" })
  checkOut?: string;
}
