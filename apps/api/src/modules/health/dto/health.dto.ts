import { ApiProperty } from "@nestjs/swagger";

export const DEPENDENCY_STATUSES = ["up", "down"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export class HealthResponseDto {
  @ApiProperty({ example: "ok" })
  status!: string;

  @ApiProperty({ example: "0.2.0" })
  version!: string;

  @ApiProperty({ example: "development", description: "development | test | staging | production" })
  environment!: string;

  @ApiProperty({ example: 1234, description: "Sekundy od startu procesu" })
  uptimeSeconds!: number;
}

export class DependencyHealthDto {
  @ApiProperty({ enum: DEPENDENCY_STATUSES })
  status!: DependencyStatus;

  @ApiProperty({ type: Number, nullable: true, description: "Czas odpowiedzi w ms" })
  latencyMs!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Klasa błędu, nigdy treść odpowiedzi ani connection string",
  })
  error!: string | null;
}

export class ReadinessResponseDto {
  @ApiProperty({ example: "ready", description: "ready | not_ready" })
  status!: string;

  @ApiProperty({ type: DependencyHealthDto })
  database!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  redis!: DependencyHealthDto;
}
