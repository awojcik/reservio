import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";

import { CurrentHost, HostGuard } from "../../auth/auth.guards";
import type { HostRow } from "../../../infrastructure/database/schema";
import {
  ConfirmImageDto,
  CreateUploadUrlDto,
  UploadUrlDto,
} from "./dto/host-image.dto";
import {
  CreateHostPropertyDto,
  ReorderImagesDto,
  UpdateHostPropertyDto,
} from "./dto/host-property-input.dto";
import {
  HostPropertyDetailDto,
  HostPropertyImageDto,
  HostPropertySummaryDto,
  PropertyNotReadyDto,
} from "./dto/host-property.dto";
import { HostImagesService } from "./host-images.service";
import { HostPropertiesService } from "./host-properties.service";

/**
 * Everything here is scoped to the authenticated Host. The route never takes a
 * hostId — it comes from Session → User → Host — and a Property owned by
 * somebody else answers 404 rather than confirming it exists.
 */
@ApiTags("host")
@ApiCookieAuth("rezervio_session")
@ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
@ApiForbiddenResponse({ description: "Konto bez profilu Host" })
@UseGuards(HostGuard)
@Controller("host/properties")
export class HostPropertiesController {
  constructor(
    private readonly hostProperties: HostPropertiesService,
    private readonly images: HostImagesService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Lista Property zalogowanego Host" })
  @ApiOkResponse({ type: [HostPropertySummaryDto] })
  list(@CurrentHost() host: HostRow): Promise<HostPropertySummaryDto[]> {
    return this.hostProperties.list(host.id);
  }

  @Post()
  @ApiOperation({
    summary: "Utworzenie Property",
    description: "Nowe Property powstaje jako DRAFT i może być niekompletne.",
  })
  @ApiCreatedResponse({ type: HostPropertyDetailDto })
  create(
    @CurrentHost() host: HostRow,
    @Body() dto: CreateHostPropertyDto,
  ): Promise<HostPropertyDetailDto> {
    return this.hostProperties.create(host.id, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Property gospodarza wraz z publishReadiness" })
  @ApiOkResponse({ type: HostPropertyDetailDto })
  @ApiNotFoundResponse({ description: "Property nie istnieje lub należy do innego Host" })
  detail(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostPropertyDetailDto> {
    return this.hostProperties.detail(host.id, id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Częściowa aktualizacja Property",
    description:
      "Zapis draftu nie wymaga kompletności. Nie zmienia hostId, status ani znaczników czasu.",
  })
  @ApiOkResponse({ type: HostPropertyDetailDto })
  @ApiNotFoundResponse({ description: "Property nie istnieje lub należy do innego Host" })
  update(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateHostPropertyDto,
  ): Promise<HostPropertyDetailDto> {
    return this.hostProperties.update(host.id, id, dto);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @ApiOperation({
    summary: "Publikacja Property",
    description:
      "Jawna komenda domenowa. Backend jest źródłem prawdy dla reguł publikacji.",
  })
  @ApiOkResponse({ type: HostPropertyDetailDto })
  @ApiUnprocessableEntityResponse({
    type: PropertyNotReadyDto,
    description: "Property nie spełnia wymagań publikacji",
  })
  @ApiConflictResponse({ description: "Nie można opublikować zarchiwizowanego Property" })
  publish(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostPropertyDetailDto> {
    return this.hostProperties.publish(host.id, id);
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  @ApiOperation({
    summary: "Wycofanie z publikacji",
    description: "PUBLISHED → SUSPENDED. Property znika z publicznego Search.",
  })
  @ApiOkResponse({ type: HostPropertyDetailDto })
  @ApiConflictResponse({ description: "Property nie jest opublikowane" })
  unpublish(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostPropertyDetailDto> {
    return this.hostProperties.unpublish(host.id, id);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @ApiOperation({
    summary: "Archiwizacja Property",
    description: "Ustawia ARCHIVED. Danych nie usuwamy twardo.",
  })
  @ApiOkResponse({ type: HostPropertyDetailDto })
  archive(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostPropertyDetailDto> {
    return this.hostProperties.archive(host.id, id);
  }

  @Post(":id/images/upload-url")
  @HttpCode(200)
  @ApiOperation({
    summary: "Presigned URL do wgrania zdjęcia",
    description:
      "Klucz obiektu jest generowany po stronie serwera na podstawie id Property.",
  })
  @ApiOkResponse({ type: UploadUrlDto })
  createUploadUrl(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<UploadUrlDto> {
    return this.images.createUploadUrl(host.id, id, dto);
  }

  @Post(":id/images")
  @ApiOperation({
    summary: "Potwierdzenie wgranego zdjęcia",
    description: "Zapisuje PropertyImage po zakończonym uploadzie do object storage.",
  })
  @ApiCreatedResponse({ type: [HostPropertyImageDto] })
  confirmImage(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmImageDto,
  ): Promise<HostPropertyImageDto[]> {
    return this.images.confirm(host.id, id, dto);
  }

  @Put(":id/images/order")
  @ApiOperation({
    summary: "Kolejność zdjęć",
    description: "Transakcyjna zmiana position; position = 0 to zdjęcie główne.",
  })
  @ApiOkResponse({ type: [HostPropertyImageDto] })
  reorderImages(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReorderImagesDto,
  ): Promise<HostPropertyImageDto[]> {
    return this.images.reorder(host.id, id, dto.imageIds);
  }

  @Delete(":id/images/:imageId")
  @ApiOperation({
    summary: "Usunięcie zdjęcia",
    description: "Po usunięciu pozycje są porządkowane do ciągu 0..n-1.",
  })
  @ApiOkResponse({ type: [HostPropertyImageDto] })
  @ApiNotFoundResponse({ description: "Zdjęcie nie istnieje" })
  removeImage(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("imageId", ParseUUIDPipe) imageId: string,
  ): Promise<HostPropertyImageDto[]> {
    return this.images.remove(host.id, id, imageId);
  }
}
