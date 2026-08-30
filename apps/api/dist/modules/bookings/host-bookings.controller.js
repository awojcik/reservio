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
exports.HostBookingsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guards_1 = require("../auth/auth.guards");
const booking_hold_worker_1 = require("./booking-hold.worker");
const bookings_service_1 = require("./bookings.service");
const booking_mapper_1 = require("./booking-mapper");
const booking_dto_1 = require("./dto/booking.dto");
let HostBookingsController = class HostBookingsController {
    bookings;
    holds;
    constructor(bookings, holds) {
        this.bookings = bookings;
        this.holds = holds;
    }
    async list(host, query) {
        const rows = await this.bookings.listForHost(host.id, query);
        return Promise.all(rows.map(async (booking) => {
            const hold = await this.bookings.findActiveHold(booking.id);
            return (0, booking_mapper_1.toHostBookingDto)(booking, hold?.expiresAt ?? null);
        }));
    }
    async detail(host, id) {
        const { booking, holdExpiresAt } = await this.bookings.findForHost(host.id, id);
        const events = await this.bookings.timelineFor(booking.id);
        return (0, booking_mapper_1.toHostBookingDto)(booking, holdExpiresAt, events);
    }
    async accept(host, id) {
        const { booking, holdExpiresAt } = await this.bookings.acceptBookingRequest(host.id, id);
        if (holdExpiresAt) {
            const hold = await this.bookings.findActiveHold(booking.id);
            if (hold)
                await this.holds.scheduleExpiry(hold.id, hold.expiresAt);
        }
        const events = await this.bookings.timelineFor(booking.id);
        return (0, booking_mapper_1.toHostBookingDto)(booking, holdExpiresAt, events);
    }
    async cancel(host, id) {
        const booking = await this.bookings.cancelBookingByHost(host.id, id);
        const events = await this.bookings.timelineFor(booking.id);
        return (0, booking_mapper_1.toHostBookingDto)(booking, null, events);
    }
    async reject(host, id) {
        const booking = await this.bookings.rejectBookingRequest(host.id, id);
        const events = await this.bookings.timelineFor(booking.id);
        return (0, booking_mapper_1.toHostBookingDto)(booking, null, events);
    }
};
exports.HostBookingsController = HostBookingsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "Rezerwacje obiektów gospodarza" }),
    (0, swagger_1.ApiOkResponse)({ type: [booking_dto_1.HostBookingDto] }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, booking_dto_1.HostBookingsQueryDto]),
    __metadata("design:returntype", Promise)
], HostBookingsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Szczegóły rezerwacji" }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.HostBookingDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostBookingsController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(":id/accept"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Akceptacja prośby o rezerwację",
        description: "Ponownie sprawdza dostępność w transakcji. Jeśli termin zdążył się zająć, zwraca 409, a rezerwacja dostaje status EXPIRED z powodem AVAILABILITY_LOST.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.HostBookingDto }),
    (0, swagger_1.ApiConflictResponse)({ description: "PROPERTY_NOT_AVAILABLE albo prośba już rozpatrzona" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostBookingsController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)(":id/cancel"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Anulowanie rezerwacji przez gospodarza",
        description: "Dozwolone, dopóki rezerwacja czeka na decyzję albo na płatność. Zwalnia blokadę terminu i zawiadamia gościa.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.HostBookingDto }),
    (0, swagger_1.ApiConflictResponse)({ description: "BOOKING_NOT_CANCELLABLE" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostBookingsController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)(":id/reject"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Odrzucenie prośby o rezerwację",
        description: "Bezpieczne przy ponowieniu — odrzucenie już odrzuconej prośby nic nie zmienia.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.HostBookingDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostBookingsController.prototype, "reject", null);
exports.HostBookingsController = HostBookingsController = __decorate([
    (0, swagger_1.ApiTags)("host"),
    (0, swagger_1.ApiCookieAuth)("rezervio_session"),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak aktywnej sesji" }),
    (0, swagger_1.ApiForbiddenResponse)({ description: "Konto bez profilu Host" }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Rezerwacja nie istnieje lub należy do innego Host" }),
    (0, common_1.UseGuards)(auth_guards_1.HostGuard),
    (0, common_1.Controller)("host/bookings"),
    __metadata("design:paramtypes", [bookings_service_1.BookingsService,
        booking_hold_worker_1.BookingHoldWorker])
], HostBookingsController);
//# sourceMappingURL=host-bookings.controller.js.map