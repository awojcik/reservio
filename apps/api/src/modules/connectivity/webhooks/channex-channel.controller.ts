import { timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { AppErrorCode } from "../../../common/app-error";
import { ChannexChangesService } from "../application/channex-changes.service";
import {
  ChannexChangesBodyDto,
  ChannexChangesAckDto,
  ChannexMappingDetailsDto,
  ChannexTestConnectionDto,
} from "../dto/channex.dto";

function keyMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The endpoints Channex calls on Rezervio.
 *
 * This is the half of the Channex contract that makes it *not* a Hostaway
 * clone: for a channel manager, Rezervio is the channel, so most of the
 * integration is a small server rather than a client. The three paths below —
 * `test_connection`, `mapping_details` and `changes` — and the `api-key`
 * header are exactly what Channex's Open Channel API specifies for an OTA
 * (milestone 12 §17, §20).
 *
 * **They are gated on partner access.** Until this deployment has a Channex
 * staging account, a registered Open Channel and a passed certification, there
 * is no api-key to compare against and every call is answered `503` with
 * `PARTNER_ACCESS_REQUIRED`. That is the honest answer: the code is right, the
 * onboarding has not happened (milestone 12 §18, §21).
 */
@ApiTags("connectivity")
@Controller("channels/channex")
export class ChannexChannelController {
  constructor(
    private readonly changes: ChannexChangesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The api-key Channex was given for this channel.
   *
   * Absent until partner onboarding is done, which is why every handler asks
   * for it before doing anything else.
   */
  private requireKey(supplied: string | undefined): void {
    const expected = (this.config.get<string>("CHANNEX_INBOUND_API_KEY") ?? "").trim();

    if (!expected) {
      throw new ServiceUnavailableException({
        code: AppErrorCode.PARTNER_ACCESS_REQUIRED,
        message:
          "Kanał Channex nie jest jeszcze aktywowany: wymaga konta staging, rejestracji Open Channel i certyfikacji.",
      });
    }

    if (!supplied || !keyMatches(supplied, expected)) {
      throw new UnauthorizedException("Nieprawidłowy klucz API.");
    }
  }

  @Get("test_connection")
  @ApiOperation({
    summary: "Channex: test połączenia",
    description:
      "Kontraktowy healthcheck kanału. Zwraca { success: true } zgodnie ze specyfikacją Open Channel API.",
  })
  @ApiOkResponse({ type: ChannexTestConnectionDto })
  @ApiUnauthorizedResponse({ description: "Nieprawidłowy klucz API" })
  @ApiServiceUnavailableResponse({ description: "PARTNER_ACCESS_REQUIRED" })
  testConnection(
    @Headers("api-key") apiKey: string | undefined,
    @Query("hotel_code") hotelCode: string | undefined,
  ): ChannexTestConnectionDto {
    this.requireKey(apiKey);
    return { success: Boolean(hotelCode) };
  }

  /**
   * The inventory Channex may map against.
   *
   * One room type with one rate plan per Property, always. Rezervio's domain is
   * one Property = one independently bookable unit, with no room types and no
   * allotment; presenting anything else would be describing inventory that does
   * not exist (domain language §1).
   */
  @Get("mapping_details")
  @ApiOperation({
    summary: "Channex: dane do mapowania",
    description:
      "Jeden room type i jeden rate plan na Property — Rezervio nie ma pokoi ani allotmentu.",
  })
  @ApiOkResponse({ type: ChannexMappingDetailsDto })
  async mappingDetails(
    @Headers("api-key") apiKey: string | undefined,
    @Query("hotel_code") hotelCode: string | undefined,
  ): Promise<ChannexMappingDetailsDto> {
    this.requireKey(apiKey);
    return this.changes.mappingDetails(hotelCode ?? "");
  }

  /**
   * Availability, rate and restriction updates from the channel manager.
   *
   * Rezervio acts on availability and `stop_sell` — the two statements that
   * change whether a Stay may be sold. Rates are accepted and ignored: pricing
   * is set by the Host in Rezervio, and letting an external system rewrite it
   * would make the price a Guest is quoted depend on a channel nobody in
   * Rezervio can see (milestone 12 §12).
   */
  @Post("changes")
  @HttpCode(200)
  @ApiOperation({
    summary: "Channex: zmiany dostępności i restrykcji",
    description:
      "Przyjmowane i stosowane pod tym samym advisory lockiem Property, co każdy inny zapis dostępności. Powtórzone `request_id` nie tworzy drugiej blokady.",
  })
  @ApiOkResponse({ type: ChannexChangesAckDto })
  async receiveChanges(
    @Headers("api-key") apiKey: string | undefined,
    @Body() body: ChannexChangesBodyDto,
  ): Promise<ChannexChangesAckDto> {
    this.requireKey(apiKey);
    return this.changes.applyChanges(body);
  }
}
