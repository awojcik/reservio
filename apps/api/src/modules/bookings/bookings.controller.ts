import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { cookieOptionsFor } from "../../infrastructure/security/cookie-options";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { AppEnvironmentService } from "../../infrastructure/security/security.module";
import { AccountService } from "../account/account.service";
import { HostsService } from "../hosts/hosts.service";
import { SessionsService } from "../auth/sessions.service";
import { BookingHoldWorker } from "./booking-hold.worker";
import { BookingLifecycleWorker } from "./booking-lifecycle.worker";
import { BookingsService } from "./bookings.service";
import {
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  GuestAccessService,
  guestTokenFrom,
} from "./guest-access.service";
import { IdempotencyService } from "./idempotency.service";
import { PaymentReadService } from "../payments/payment-read.service";
import { toBookingDto } from "./booking-mapper";
import { BookingDto, CreateBookingDto, GuestAccessDto } from "./dto/booking.dto";

const IDEMPOTENCY_SCOPE = "bookings.create";

type CookieRequest = FastifyRequest & { cookies?: Record<string, string | undefined> };

@ApiTags("bookings")
@UseGuards(RateLimitGuard)
@Controller("bookings")
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly idempotency: IdempotencyService,
    private readonly holds: BookingHoldWorker,
    private readonly lifecycle: BookingLifecycleWorker,
    private readonly guestAccess: GuestAccessService,
    private readonly sessions: SessionsService,
    private readonly hosts: HostsService,
    private readonly account: AccountService,
    private readonly paymentState: PaymentReadService,
    private readonly environment: AppEnvironmentService,
  ) {}

  /**
   * Resolves the signed-in account, if any.
   *
   * Deliberately not a guard: booking must work without an account, so a
   * missing or stale session is a normal outcome here, not a 401
   * (milestone 06 §2).
   */
  private async optionalUser(
    request: CookieRequest,
  ): Promise<{ id: string; email: string; hostId: string | null } | null> {
    const token = request.cookies?.[this.sessions.cookieName];
    if (!token) return null;

    const user = await this.sessions.resolve(token);
    if (!user) return null;

    const host = await this.hosts.findByUserId(user.id);
    return { id: user.id, email: user.email, hostId: host?.id ?? null };
  }

  @Post()
  @ApiOperation({
    summary: "Utworzenie rezerwacji",
    description:
      "Flow wybiera backend na podstawie Property.bookingMode. INSTANT_BOOK tworzy rezerwację z blokadą terminu, REQUEST_TO_BOOK czeka na decyzję gospodarza i niczego nie blokuje. Cenę wylicza serwer.",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Ten sam klucz i te same dane zwracają tę samą rezerwację.",
  })
  @ApiCreatedResponse({ type: BookingDto })
  @ApiConflictResponse({
    description: "PROPERTY_NOT_AVAILABLE albo IDEMPOTENCY_KEY_REUSED",
  })
  async create(
    @Body() dto: CreateBookingDto,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<BookingDto> {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new BadRequestException("Wymagany nagłówek Idempotency-Key.");
    }

    const currentUser = await this.optionalUser(request);

    // A replay returns the original Booking rather than creating a second one.
    const existing = await this.idempotency.lookup(IDEMPOTENCY_SCOPE, key, dto);
    if (existing) return this.render(existing.resourceId);

    const { booking, holdExpiresAt, guestAccessToken } = await this.bookings.createBooking({
      propertyId: dto.propertyId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      adults: dto.adults,
      children: dto.children ?? 0,
      guest: dto.guest,
      // Linked to the account when somebody is signed in; anonymous otherwise.
      guestUserId: currentUser?.id ?? null,
      actingHostId: currentUser?.hostId ?? null,
    });

    const stored = await this.idempotency.remember(IDEMPOTENCY_SCOPE, key, dto, {
      type: "booking",
      id: booking.id,
    });

    // Lost a concurrent race on the same key: return whichever Booking won, so
    // both callers see one result.
    if (stored.storedId !== booking.id) return this.render(stored.storedId);

    // Scheduled after the transaction committed — enqueueing inside it could
    // fire before the hold is visible to another connection.
    if (holdExpiresAt) {
      const hold = await this.bookings.findActiveHold(booking.id);
      if (hold) await this.holds.scheduleExpiry(hold.id, hold.expiresAt);
    }

    // Reminder and expiry for a request awaiting the Host. The deadline in the
    // row remains authoritative; these jobs only act on it.
    if (booking.hostResponseDeadlineAt) {
      await this.lifecycle.scheduleRequest(booking.id, booking.hostResponseDeadlineAt);
    }

    // Set here rather than handed back in the body: the Guest is authenticated
    // for their own Booking immediately, and the token never reaches the URL.
    if (guestAccessToken) this.setGuestCookie(reply, guestAccessToken);

    // The creation event is already committed, so the caller gets a timeline
    // consistent with every later read.
    const events = await this.bookings.timelineFor(booking.id);
    return toBookingDto(booking, holdExpiresAt, events);
  }

  /*
   * The only endpoint that turns a Booking reference plus a token into a
   * cookie, so it is also the only place worth guessing at. Keyed by reference
   * as well as address: one Guest retrying their own link must not consume the
   * budget of everyone behind the same NAT (milestone 11 §20).
   */
  @RateLimit({
    bucket: "guest-access",
    limit: 20,
    windowSeconds: 300,
    scope: "route-param",
    param: "reference",
  })
  @Post(":reference/access")
  @HttpCode(200)
  @ApiOperation({
    summary: "Wymiana tokenu gościa na sesję",
    description:
      "Przyjmuje token z linku w emailu i ustawia HttpOnly cookie, dzięki czemu sekret znika z adresu URL.",
  })
  @ApiOkResponse({ type: BookingDto })
  @ApiUnauthorizedResponse({ description: "Token nieprawidłowy, wygasły albo unieważniony" })
  async exchangeAccess(
    @Param("reference") reference: string,
    @Body() dto: GuestAccessDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BookingDto> {
    const bookingId = await this.guestAccess.verify(reference, dto.token);

    this.setGuestCookie(reply, dto.token);
    return this.render(bookingId);
  }

  @Post(":reference/claim")
  @HttpCode(200)
  @ApiOperation({
    summary: "Przypisanie rezerwacji do konta",
    description:
      "Wymaga jednocześnie zalogowanego konta, ważnego tokenu dostępu gościa i zgodnego adresu email. Sam numer rezerwacji albo sam email nie wystarczają.",
  })
  @ApiOkResponse({ description: "Rezerwacja przypisana do konta" })
  @ApiConflictResponse({
    description: "BOOKING_ALREADY_CLAIMED albo BOOKING_EMAIL_MISMATCH",
  })
  @ApiUnauthorizedResponse({ description: "Brak sesji albo brak dostępu gościa" })
  async claim(
    @Param("reference") reference: string,
    @Req() request: CookieRequest,
  ): Promise<BookingDto> {
    const currentUser = await this.optionalUser(request);
    if (!currentUser) {
      throw new UnauthorizedException("Zaloguj się, aby zapisać tę podróż na koncie.");
    }

    const guestToken = guestTokenFrom(request);
    if (!guestToken) {
      throw new UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
    }

    const trip = await this.account.claim(
      currentUser.id,
      currentUser.email,
      reference,
      guestToken,
    );

    return this.render(trip.id);
  }

  @Get(":reference")
  @ApiOperation({
    summary: "Status rezerwacji",
    description:
      "Wymaga dostępu gościa: tokenu w cookie albo w parametrze. Sama referencja nie wystarcza.",
  })
  @ApiOkResponse({ type: BookingDto })
  @ApiUnauthorizedResponse({ description: "Brak ważnego dostępu gościa" })
  async findOne(
    @Param("reference") reference: string,
    @Req() request: CookieRequest,
  ): Promise<BookingDto> {
    const bookingId = await this.requireGuestAccess(reference, request);
    return this.render(bookingId);
  }

  @Post(":reference/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Anulowanie przez gościa",
    description:
      "Dozwolone, dopóki rezerwacja czeka na gospodarza albo na płatność. Zwalnia blokadę terminu.",
  })
  @ApiOkResponse({ type: BookingDto })
  @ApiConflictResponse({ description: "BOOKING_NOT_CANCELLABLE" })
  @ApiUnauthorizedResponse({ description: "Brak ważnego dostępu gościa" })
  async cancel(
    @Param("reference") reference: string,
    @Req() request: CookieRequest,
  ): Promise<BookingDto> {
    const bookingId = await this.requireGuestAccess(reference, request);
    await this.bookings.cancelBookingByGuest(bookingId);
    return this.render(bookingId);
  }

  /**
   * The reference alone is never enough: it appears in emails and is quoted
   * over the phone, so it identifies a Booking without authorising anything
   * (milestone 05 §66).
   */
  private setGuestCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(
      GUEST_COOKIE,
      token,
      cookieOptionsFor(this.environment.name, GUEST_COOKIE_MAX_AGE),
    );
  }

  private async requireGuestAccess(
    reference: string,
    request: CookieRequest,
  ): Promise<string> {
    const token = guestTokenFrom(request);

    if (!token) {
      throw new UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
    }

    return this.guestAccess.verify(reference, token);
  }

  private async render(bookingId: string): Promise<BookingDto> {
    const booking = await this.bookings.findByIdInternal(bookingId);
    const { holdExpiresAt } = await this.bookings.findByReference(booking.publicReference);
    const [events, payment] = await Promise.all([
      this.bookings.timelineFor(bookingId),
      this.paymentState.forBooking(bookingId),
    ]);

    return toBookingDto(booking, holdExpiresAt, events, payment);
  }
}
