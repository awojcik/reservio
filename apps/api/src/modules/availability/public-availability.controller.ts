import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { mergeRanges } from "../../domain/availability";
import { PropertiesService } from "../properties/properties.service";
import { AvailabilityService } from "./availability.service";
import { CalendarWindowDto, PublicAvailabilityDto } from "./dto/availability.dto";

@ApiTags("properties")
@Controller("properties")
export class PublicAvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly properties: PropertiesService,
  ) {}

  @Get(":slug/availability")
  @ApiOperation({
    summary: "Zajęte terminy Property",
    description:
      "Zakresy niedostępności dla opublikowanego Property. Źródło blokady, notatki Host i status synchronizacji nie są ujawniane.",
  })
  @ApiOkResponse({ type: PublicAvailabilityDto })
  @ApiNotFoundResponse({ description: "Property nie istnieje albo nie jest opublikowane" })
  async availabilityFor(
    @Param("slug") slug: string,
    @Query() window: CalendarWindowDto,
  ): Promise<PublicAvailabilityDto> {
    // Resolves the slug and enforces PUBLISHED in one step, so a DRAFT cannot
    // have its calendar read from the public side.
    const property = await this.properties.findPublishedSummary(slug);

    const blocks = await this.availability.getBlocks(property.id, {
      startDate: window.from,
      endDate: window.to,
    });

    // Merged and stripped: a Guest learns which dates are taken, never why.
    const unavailableRanges = mergeRanges(
      blocks.map((block) => ({ startDate: block.startDate, endDate: block.endDate })),
    );

    return {
      propertyId: property.id,
      from: window.from,
      to: window.to,
      unavailableRanges,
    };
  }
}
