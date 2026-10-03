import { ApiProperty } from "@nestjs/swagger";
import { Allow } from "class-validator";

/**
 * The Channex Open Channel API shapes, verbatim.
 *
 * Field names are snake_case because that is what the contract uses. They are
 * not translated into Rezervio's own vocabulary at the edge on purpose: this
 * file *is* the contract, and a renamed field here would be a field that
 * silently stops matching when Channex sends it (milestone 12 §20).
 */
export class ChannexTestConnectionDto {
  @ApiProperty({ example: true })
  success!: boolean;
}

export class ChannexRatePlanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ["per_room", "per_person"] })
  sell_mode!: string;

  @ApiProperty()
  max_persons!: number;

  @ApiProperty({ example: "PLN" })
  currency!: string;

  @ApiProperty({ description: "Rezervio nie przyjmuje cen z kanału." })
  read_only!: boolean;
}

export class ChannexRoomTypeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [ChannexRatePlanDto] })
  rate_plans!: ChannexRatePlanDto[];
}

export class ChannexMappingAttributesDto {
  @ApiProperty({ type: [ChannexRoomTypeDto] })
  room_types!: ChannexRoomTypeDto[];
}

export class ChannexMappingDataDto {
  @ApiProperty({ example: "mapping_details" })
  type!: string;

  @ApiProperty({ type: ChannexMappingAttributesDto })
  attributes!: ChannexMappingAttributesDto;
}

export class ChannexMappingDetailsDto {
  @ApiProperty({ type: ChannexMappingDataDto })
  data!: ChannexMappingDataDto;
}

/**
 * The changes payload, as Channex posts it.
 *
 * Deliberately typed loosely below the top level: the contract nests
 * heterogeneous change entries under one array, and validating each variant
 * with class-validator would reject a shape Channex is entitled to send. The
 * service reads what it understands and ignores the rest.
 */
export class ChannexChangesBodyDto {
  /*
   * `@Allow` rather than a validator: the global pipe whitelists, and a
   * property with no decorator at all would be stripped before the service
   * ever sees it. The shape is Channex's to define, so it is accepted as sent
   * and read defensively.
   */
  @Allow()
  @ApiProperty({ type: Object, isArray: true })
  data!: {
    type?: string;
    attributes?: {
      request_id?: string;
      hotel_code?: string;
      changes?: {
        type?: string;
        attributes?: Record<string, unknown>;
      }[];
    };
  }[];
}

export class ChannexChangesAckDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({
    example: "b1a1…",
    description: "Identyfikator, po którym Channex rozpoznaje przetworzoną paczkę.",
  })
  unique_id!: string;
}
