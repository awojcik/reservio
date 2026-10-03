import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import { PropertyDetailDto } from "./dto/property.dto";
import { PropertyStayQueryDto } from "./dto/property-stay-query.dto";
import { PropertiesService } from "./properties.service";

@ApiTags("properties")
@Controller("properties")
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get(":slug")
  @ApiOperation({
    summary: "Szczegóły Property",
    description:
      "Slug jest publiczną tożsamością routingową; UUID jest akceptowany dla zgodności ze starszymi linkami.",
  })
  @ApiParam({ name: "slug", example: "baltic-loft-brzezno" })
  @ApiOkResponse({ type: PropertyDetailDto })
  @ApiNotFoundResponse({ description: "Property nie istnieje albo nie jest opublikowane" })
  findOne(
    @Param("slug") slug: string,
    @Query() stay: PropertyStayQueryDto,
  ): Promise<PropertyDetailDto> {
    return this.properties.findPublished(slug, stay);
  }
}
