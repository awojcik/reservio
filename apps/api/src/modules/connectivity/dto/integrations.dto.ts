import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

import {
  CONNECTION_STATUSES,
  CONNECTION_STATUS_REASONS,
  EXTERNAL_PROVIDERS,
} from "../../../infrastructure/database/schema";

export class ConnectHostawayDto {
  @ApiProperty({
    description: "Hostaway Account ID — z panelu Hostaway. Nie jest sekretem.",
    example: "12345",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  accountId!: string;

  @ApiProperty({
    description:
      "Hostaway API key (client secret). Szyfrowany przy zapisie, nigdy nie wraca przez API.",
  })
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  apiKey!: string;
}

export class CreateMappingDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ description: "Identyfikator listingu u dostawcy." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalPropertyId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  externalPropertyName?: string;
}

export class SyncAttemptDto {
  @ApiProperty()
  syncType!: string;

  @ApiProperty({ enum: ["RUNNING", "SUCCEEDED", "FAILED"] })
  status!: string;

  @ApiProperty()
  startedAt!: string;

  @ApiProperty({ type: String, nullable: true })
  completedAt!: string | null;

  @ApiProperty()
  itemsProcessed!: number;

  @ApiProperty()
  itemsFailed!: number;

  @ApiProperty({ type: String, nullable: true })
  errorCode!: string | null;
}

export class PropertyMappingDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty()
  propertyTitle!: string;

  @ApiProperty()
  externalPropertyId!: string;

  @ApiProperty({ type: String, nullable: true })
  externalPropertyName!: string | null;

  @ApiProperty({ enum: ["ACTIVE", "PAUSED"] })
  status!: string;

  @ApiProperty({
    description: "Ile aktywnych rezerwacji z tego źródła blokuje kalendarz obiektu.",
  })
  activeReservations!: number;
}

export class IntegrationDto {
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  id!: string | null;

  @ApiProperty({ enum: EXTERNAL_PROVIDERS })
  provider!: string;

  @ApiProperty({
    enum: CONNECTION_STATUSES,
    description: "NOT_CONNECTED, gdy Host jeszcze nie podłączył tego dostawcy.",
  })
  status!: string;

  @ApiProperty({ enum: CONNECTION_STATUS_REASONS, nullable: true, type: String })
  statusReason!: string | null;

  @ApiProperty({
    description:
      "Czy dostawca jest w ogóle dostępny w tym wdrożeniu. Channex wymaga dostępu partnerskiego.",
  })
  available!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Identyfikator konta u dostawcy. Klucz API nigdy nie jest zwracany.",
  })
  externalAccountId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastSuccessfulSyncAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastFailedSyncAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty()
  mappedProperties!: number;

  @ApiProperty({ type: [SyncAttemptDto] })
  recentSyncs!: SyncAttemptDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Adres, który Host wpisuje w panelu dostawcy. Sekret webhooka pokazywany jest raz, przy połączeniu.",
  })
  webhookUrl!: string | null;
}

export class IntegrationsPageDto {
  @ApiProperty({ type: [IntegrationDto] })
  items!: IntegrationDto[];

  @ApiProperty({
    description: "Czy jakikolwiek obiekt Hosta jest podpięty także przez iCal.",
  })
  icalAlsoConnected!: boolean;
}

export class ExternalListingDto {
  @ApiProperty()
  externalId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ description: "Czy ten listing jest już zmapowany." })
  mapped!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    format: "uuid",
    description:
      "Propozycja dopasowania po dokładnej nazwie. Sugestia — mapowanie zatwierdza Host.",
  })
  suggestedPropertyId!: string | null;
}

export class ExternalListingsDto {
  @ApiProperty({ type: [ExternalListingDto] })
  items!: ExternalListingDto[];

  @ApiProperty({ type: [PropertyMappingDto] })
  mappings!: PropertyMappingDto[];
}

export class ConnectResultDto {
  @ApiProperty({ type: IntegrationDto })
  integration!: IntegrationDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Hasło webhooka. Pokazywane wyłącznie raz, przy połączeniu — potem nie da się go odczytać.",
  })
  webhookSecret!: string | null;
}

export class SyncQueuedDto {
  @ApiProperty({ example: "QUEUED" })
  status!: string;

  @ApiProperty({ description: "False, gdy synchronizacja już była zaplanowana." })
  queued!: boolean;
}

export class IntegrationsQueryDto {
  @ApiProperty({ required: false, enum: EXTERNAL_PROVIDERS })
  @IsOptional()
  @IsIn(EXTERNAL_PROVIDERS as unknown as string[])
  @Type(() => String)
  provider?: string;
}
