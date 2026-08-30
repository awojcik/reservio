import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";

import { AMENITY_CODES } from "../../domain/amenities";

export class AmenityDto {
  @ApiProperty({ example: "SEA_VIEW", description: "Stabilny kod domenowy Amenity" })
  code!: string;
}

@ApiTags("amenities")
@Controller("amenities")
export class AmenitiesController {
  @Get()
  @ApiOperation({
    summary: "Słownik Amenity",
    description:
      "Kanoniczne kody Amenity. Tłumaczenia są warstwą prezentacji i nie należą do kontraktu API.",
  })
  @ApiOkResponse({ type: [AmenityDto] })
  findAll(): AmenityDto[] {
    return AMENITY_CODES.map((code) => ({ code }));
  }
}
