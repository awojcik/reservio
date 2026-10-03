import { ApiProperty } from "@nestjs/swagger";

export class WebhookAckDto {
  @ApiProperty({ example: true })
  received!: boolean;

  @ApiProperty({
    example: false,
    description: "Zdarzenie było już przyjęte — nie wywołało drugiego efektu.",
  })
  duplicate!: boolean;
}
