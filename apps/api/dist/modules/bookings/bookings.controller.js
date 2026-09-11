"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const cookie_options_1 = require("../../infrastructure/security/cookie-options");
const rate_limit_guard_1 = require("../../infrastructure/security/rate-limit.guard");
const security_module_1 = require("../../infrastructure/security/security.module");
const account_service_1 = require("../account/account.service");
const hosts_service_1 = require("../hosts/hosts.service");
const sessions_service_1 = require("../auth/sessions.service");
const booking_hold_worker_1 = require("./booking-hold.worker");
const booking_lifecycle_worker_1 = require("./booking-lifecycle.worker");
const bookings_service_1 = require("./bookings.service");
const guest_access_service_1 = require("./guest-access.service");
const idempotency_service_1 = require("./idempotency.service");
const payment_read_service_1 = require("../payments/payment-read.service");
const booking_mapper_1 = require("./booking-mapper");
const booking_dto_1 = require("./dto/booking.dto");
const IDEMPOTENCY_SCOPE = "bookings.create";
let BookingsController = class BookingsController {
    bookings;
    idempotency;
    holds;
    lifecycle;
    guestAccess;
    sessions;
    hosts;
    account;
    paymentState;
    environment;
    constructor(bookings, idempotency, holds, lifecycle, guestAccess, sessions, hosts, account, paymentState, environment) {
        this.bookings = bookings;
        this.idempotency = idempotency;
        this.holds = holds;
        this.lifecycle = lifecycle;
        this.guestAccess = guestAccess;
        this.sessions = sessions;
        this.hosts = hosts;
        this.account = account;
        this.paymentState = paymentState;
        this.environment = environment;
    }
    async optionalUser(request) {
        const token = request.cookies?.[this.sessions.cookieName];
        if (!token)
            return null;
        const user = await this.sessions.resolve(token);
        if (!user)
            return null;
        const host = await this.hosts.findByUserId(user.id);
        return { id: user.id, email: user.email, hostId: host?.id ?? null };
    }
    async create(dto, request, reply, idempotencyKey) {
        const key = idempotencyKey?.trim();
        if (!key) {
            throw new common_1.BadRequestException("Wymagany nagłówek Idempotency-Key.");
        }
        const currentUser = await this.optionalUser(request);
        const existing = await this.idempotency.lookup(IDEMPOTENCY_SCOPE, key, dto);
        if (existing)
            return this.render(existing.resourceId);
        const { booking, holdExpiresAt, guestAccessToken } = await this.bookings.createBooking({
            propertyId: dto.propertyId,
            checkIn: dto.checkIn,
            checkOut: dto.checkOut,
            adults: dto.adults,
            children: dto.children ?? 0,
            guest: dto.guest,
            guestUserId: currentUser?.id ?? null,
            actingHostId: currentUser?.hostId ?? null,
        });
        const stored = await this.idempotency.remember(IDEMPOTENCY_SCOPE, key, dto, {
            type: "booking",
            id: booking.id,
        });
        if (stored.storedId !== booking.id)
            return this.render(stored.storedId);
        if (holdExpiresAt) {
            const hold = await this.bookings.findActiveHold(booking.id);
            if (hold)
                await this.holds.scheduleExpiry(hold.id, hold.expiresAt);
        }
        if (booking.hostResponseDeadlineAt) {
            await this.lifecycle.scheduleRequest(booking.id, booking.hostResponseDeadlineAt);
        }
        if (guestAccessToken)
            this.setGuestCookie(reply, guestAccessToken);
        const events = await this.bookings.timelineFor(booking.id);
        return (0, booking_mapper_1.toBookingDto)(booking, holdExpiresAt, events);
    }
    async exchangeAccess(reference, dto, reply) {
        const bookingId = await this.guestAccess.verify(reference, dto.token);
        this.setGuestCookie(reply, dto.token);
        return this.render(bookingId);
    }
    async claim(reference, request) {
        const currentUser = await this.optionalUser(request);
        if (!currentUser) {
            throw new common_1.UnauthorizedException("Zaloguj się, aby zapisać tę podróż na koncie.");
        }
        const guestToken = (0, guest_access_service_1.guestTokenFrom)(request);
        if (!guestToken) {
            throw new common_1.UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
        }
        const trip = await this.account.claim(currentUser.id, currentUser.email, reference, guestToken);
        return this.render(trip.id);
    }
    async findOne(reference, request) {
        const bookingId = await this.requireGuestAccess(reference, request);
        return this.render(bookingId);
    }
    async cancel(reference, request) {
        const bookingId = await this.requireGuestAccess(reference, request);
        await this.bookings.cancelBookingByGuest(bookingId);
        return this.render(bookingId);
    }
    setGuestCookie(reply, token) {
        reply.setCookie(guest_access_service_1.GUEST_COOKIE, token, (0, cookie_options_1.cookieOptionsFor)(this.environment.name, guest_access_service_1.GUEST_COOKIE_MAX_AGE));
    }
    async requireGuestAccess(reference, request) {
        const token = (0, guest_access_service_1.guestTokenFrom)(request);
        if (!token) {
            throw new common_1.UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
        }
        return this.guestAccess.verify(reference, token);
    }
    async render(bookingId) {
        const booking = await this.bookings.findByIdInternal(bookingId);
        const { holdExpiresAt } = await this.bookings.findByReference(booking.publicReference);
        const [events, payment] = await Promise.all([
            this.bookings.timelineFor(bookingId),
            this.paymentState.forBooking(bookingId),
        ]);
        return (0, booking_mapper_1.toBookingDto)(booking, holdExpiresAt, events, payment);
    }
};
exports.BookingsController = BookingsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({
        summary: "Utworzenie rezerwacji",
        description: "Flow wybiera backend na podstawie Property.bookingMode. INSTANT_BOOK tworzy rezerwację z blokadą terminu, REQUEST_TO_BOOK czeka na decyzję gospodarza i niczego nie blokuje. Cenę wylicza serwer.",
    }),
    (0, swagger_1.ApiHeader)({
        name: "Idempotency-Key",
        required: true,
        description: "Ten sam klucz i te same dane zwracają tę samą rezerwację.",
    }),
    (0, swagger_1.ApiCreatedResponse)({ type: booking_dto_1.BookingDto }),
    (0, swagger_1.ApiConflictResponse)({
        description: "PROPERTY_NOT_AVAILABLE albo IDEMPOTENCY_KEY_REUSED",
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __param(3, (0, common_1.Headers)("idempotency-key")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [booking_dto_1.CreateBookingDto, Object, Object, String]),
    __metadata("design:returntype", Promise)
], BookingsController.prototype, "create", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)({
        bucket: "guest-access",
        limit: 20,
        windowSeconds: 300,
        scope: "route-param",
        param: "reference",
    }),
    (0, common_1.Post)(":reference/access"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Wymiana tokenu gościa na sesję",
        description: "Przyjmuje token z linku w emailu i ustawia HttpOnly cookie, dzięki czemu sekret znika z adresu URL.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Token nieprawidłowy, wygasły albo unieważniony" }),
    __param(0, (0, common_1.Param)("reference")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, booking_dto_1.GuestAccessDto, Object]),
    __metadata("design:returntype", Promise)
], BookingsController.prototype, "exchangeAccess", null);
__decorate([
    (0, common_1.Post)(":reference/claim"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Przypisanie rezerwacji do konta",
        description: "Wymaga jednocześnie zalogowanego konta, ważnego tokenu dostępu gościa i zgodnego adresu email. Sam numer rezerwacji albo sam email nie wystarczają.",
    }),
    (0, swagger_1.ApiOkResponse)({ description: "Rezerwacja przypisana do konta" }),
    (0, swagger_1.ApiConflictResponse)({
        description: "BOOKING_ALREADY_CLAIMED albo BOOKING_EMAIL_MISMATCH",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak sesji albo brak dostępu gościa" }),
    __param(0, (0, common_1.Param)("reference")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BookingsController.prototype, "claim", null);
__decorate([
    (0, common_1.Get)(":reference"),
    (0, swagger_1.ApiOperation)({
        summary: "Status rezerwacji",
        description: "Wymaga dostępu gościa: tokenu w cookie albo w parametrze. Sama referencja nie wystarcza.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak ważnego dostępu gościa" }),
    __param(0, (0, common_1.Param)("reference")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BookingsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(":reference/cancel"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Anulowanie przez gościa",
        description: "Dozwolone, dopóki rezerwacja czeka na gospodarza albo na płatność. Zwalnia blokadę terminu.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, swagger_1.ApiConflictResponse)({ description: "BOOKING_NOT_CANCELLABLE" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak ważnego dostępu gościa" }),
    __param(0, (0, common_1.Param)("reference")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BookingsController.prototype, "cancel", null);
exports.BookingsController = BookingsController = __decorate([
    (0, swagger_1.ApiTags)("bookings"),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, common_1.Controller)("bookings"),
    __metadata("design:paramtypes", [bookings_service_1.BookingsService,
        idempotency_service_1.IdempotencyService,
        booking_hold_worker_1.BookingHoldWorker,
        booking_lifecycle_worker_1.BookingLifecycleWorker,
        guest_access_service_1.GuestAccessService,
        sessions_service_1.SessionsService,
        hosts_service_1.HostsService,
        account_service_1.AccountService,
        payment_read_service_1.PaymentReadService,
        security_module_1.AppEnvironmentService])
], BookingsController);
//# sourceMappingURL=bookings.controller.js.map