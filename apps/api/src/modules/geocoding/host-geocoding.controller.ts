import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import { AppError, AppErrorCode } from "../../common/app-error";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { HostGuard } from "../auth/auth.guards";
import { GeocodingUnavailableError } from "./domain/geocoding-provider";
import { GeocodingService } from "./geocoding.service";
import { GeocodeRequestDto, GeocodeResponseDto } from "./dto/geocoding.dto";

/**
 * Address → point, for the Property editor.
 *
 * Server-side rather than a call from the browser, for three reasons: the
 * provider's usage policy asks for one request per second and a User-Agent
 * that identifies us, neither of which a browser can be held to; the answer is
 * cached once for everybody instead of once per Host; and a Host's street
 * address never leaves Rezervio's own origin in a request anyone can watch.
 */
@ApiTags("host-properties")
@ApiCookieAuth()
@UseGuards(HostGuard, RateLimitGuard)
@Controller("host/geocode")
export class HostGeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Post()
  @HttpCode(200)
  /*
   * Generous enough for someone genuinely editing an address, tight enough
   * that a stuck keystroke cannot become a load test against a free service
   * the whole OpenStreetMap community shares. The client debounces as well.
   */
  @RateLimit({ bucket: "geocode", limit: 30, windowSeconds: 60, scope: "user" })
  @ApiOperation({
    summary: "Znajdź współrzędne dla adresu",
    description:
      "Zwraca punkt razem z precyzją dopasowania. `found: false` znaczy, że dostawca odpowiedział, ale nie zna takiego adresu — to nie jest błąd.",
  })
  @ApiOkResponse({ type: GeocodeResponseDto })
  @ApiServiceUnavailableResponse({ description: "GEOCODING_UNAVAILABLE" })
  async geocode(@Body() dto: GeocodeRequestDto): Promise<GeocodeResponseDto> {
    try {
      const outcome = await this.geocoding.geocode(
        {
          addressLine1: dto.addressLine1 ?? null,
          postalCode: dto.postalCode ?? null,
          city: dto.city,
          district: dto.district ?? null,
          countryCode: dto.countryCode,
        },
        { refresh: dto.refresh === true },
      );

      if (!outcome.found) {
        // Not an error: the address may simply not be in the data yet, and the
        // Host can still place the marker by hand.
        return { found: false, latitude: null, longitude: null, precision: null, formattedAddress: null };
      }

      return {
        found: true,
        latitude: outcome.result.latitude,
        longitude: outcome.result.longitude,
        precision: outcome.result.precision,
        formattedAddress: outcome.result.formattedAddress,
      };
    } catch (error) {
      if (error instanceof GeocodingUnavailableError) {
        /*
         * 503, not 500: the request was fine and Rezervio is healthy — a third
         * party is not answering. The Host can still drag the marker, so this
         * degrades rather than blocks.
         */
        throw new AppError(
          AppErrorCode.GEOCODING_UNAVAILABLE,
          error.message,
          HttpStatus.SERVICE_UNAVAILABLE,
          { providerCode: error.code },
        );
      }
      throw error;
    }
  }
}
