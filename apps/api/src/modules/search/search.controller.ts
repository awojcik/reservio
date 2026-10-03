import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { SearchResponseDto } from "../properties/dto/property.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { SearchService } from "./search.service";

@ApiTags("search")
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: "Wyszukiwanie Property",
    description:
      "Filtrowanie, sortowanie i wycena wykonywane w PostgreSQL. Zwraca wyłącznie Property o statusie PUBLISHED.",
  })
  @ApiOkResponse({ type: SearchResponseDto })
  find(@Query() query: SearchQueryDto): Promise<SearchResponseDto> {
    return this.search.search(query);
  }
}
