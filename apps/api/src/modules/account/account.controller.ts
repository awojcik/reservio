import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { CurrentUser, SessionGuard } from "../auth/auth.guards";
import type { SessionUser } from "../auth/sessions.service";
import { toBookingDto } from "../bookings/booking-mapper";
import { AccountService, type TripRow } from "./account.service";
import {
  ProfileDto,
  TripDto,
  TripsPageDto,
  TripsQueryDto,
  UpdateProfileDto,
} from "./dto/account.dto";

function toTripDto(trip: TripRow): TripDto {
  return {
    ...toBookingDto(trip, null),
    category: trip.category,
    propertyCity: trip.propertyCitySnapshot,
    coverImageUrl: trip.coverImageUrlSnapshot,
    propertySlug: trip.propertySlug,
  };
}

/**
 * The signed-in User's own area. Everything here is scoped to the session —
 * no endpoint takes a user id, so one account cannot ask for another's data.
 */
@ApiTags("account")
@ApiCookieAuth("rezervio_session")
@ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
@UseGuards(SessionGuard)
@Controller("account")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get("profile")
  @ApiOperation({ summary: "Profil zalogowanego User" })
  @ApiOkResponse({ type: ProfileDto })
  profile(@CurrentUser() user: SessionUser): Promise<ProfileDto> {
    return this.account.profile(user.id);
  }

  @Patch("profile")
  @ApiOperation({
    summary: "Edycja profilu",
    description:
      "Zmienia wyłącznie dane profilowe. Email jest tożsamością logowania i tu się go nie zmienia. Rezerwacje zachowują dane podane przy ich składaniu.",
  })
  @ApiOkResponse({ type: ProfileDto })
  updateProfile(
    @CurrentUser() user: SessionUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.account.updateProfile(user.id, dto);
  }

  @Get("bookings")
  @ApiOperation({
    summary: "Moje podróże",
    description:
      "Rezerwacje przypisane do konta. Wyszukiwane po guest_user_id, nigdy po adresie email.",
  })
  @ApiOkResponse({ type: TripsPageDto })
  async trips(
    @CurrentUser() user: SessionUser,
    @Query() query: TripsQueryDto,
  ): Promise<TripsPageDto> {
    const page = await this.account.trips(user.id, query);
    return { items: page.items.map(toTripDto), nextCursor: page.nextCursor };
  }

  @Get("bookings/:reference")
  @ApiOperation({ summary: "Szczegóły podróży" })
  @ApiOkResponse({ type: TripDto })
  @ApiNotFoundResponse({ description: "Rezerwacja nie istnieje lub należy do innego konta" })
  async trip(
    @CurrentUser() user: SessionUser,
    @Param("reference") reference: string,
  ): Promise<TripDto> {
    return toTripDto(await this.account.trip(user.id, reference));
  }
}
