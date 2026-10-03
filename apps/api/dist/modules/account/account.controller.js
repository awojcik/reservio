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
exports.AccountController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guards_1 = require("../auth/auth.guards");
const booking_mapper_1 = require("../bookings/booking-mapper");
const account_service_1 = require("./account.service");
const account_dto_1 = require("./dto/account.dto");
function toTripDto(trip) {
    return {
        ...(0, booking_mapper_1.toBookingDto)(trip, null),
        category: trip.category,
        propertyCity: trip.propertyCitySnapshot,
        coverImageUrl: trip.coverImageUrlSnapshot,
        propertySlug: trip.propertySlug,
    };
}
let AccountController = class AccountController {
    account;
    constructor(account) {
        this.account = account;
    }
    profile(user) {
        return this.account.profile(user.id);
    }
    updateProfile(user, dto) {
        return this.account.updateProfile(user.id, dto);
    }
    async trips(user, query) {
        const page = await this.account.trips(user.id, query);
        return { items: page.items.map(toTripDto), nextCursor: page.nextCursor };
    }
    async trip(user, reference) {
        return toTripDto(await this.account.trip(user.id, reference));
    }
};
exports.AccountController = AccountController;
__decorate([
    (0, common_1.Get)("profile"),
    (0, swagger_1.ApiOperation)({ summary: "Profil zalogowanego User" }),
    (0, swagger_1.ApiOkResponse)({ type: account_dto_1.ProfileDto }),
    __param(0, (0, auth_guards_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "profile", null);
__decorate([
    (0, common_1.Patch)("profile"),
    (0, swagger_1.ApiOperation)({
        summary: "Edycja profilu",
        description: "Zmienia wyłącznie dane profilowe. Email jest tożsamością logowania i tu się go nie zmienia. Rezerwacje zachowują dane podane przy ich składaniu.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: account_dto_1.ProfileDto }),
    __param(0, (0, auth_guards_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, account_dto_1.UpdateProfileDto]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "updateProfile", null);
__decorate([
    (0, common_1.Get)("bookings"),
    (0, swagger_1.ApiOperation)({
        summary: "Moje podróże",
        description: "Rezerwacje przypisane do konta. Wyszukiwane po guest_user_id, nigdy po adresie email.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: account_dto_1.TripsPageDto }),
    __param(0, (0, auth_guards_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, account_dto_1.TripsQueryDto]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "trips", null);
__decorate([
    (0, common_1.Get)("bookings/:reference"),
    (0, swagger_1.ApiOperation)({ summary: "Szczegóły podróży" }),
    (0, swagger_1.ApiOkResponse)({ type: account_dto_1.TripDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Rezerwacja nie istnieje lub należy do innego konta" }),
    __param(0, (0, auth_guards_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("reference")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "trip", null);
exports.AccountController = AccountController = __decorate([
    (0, swagger_1.ApiTags)("account"),
    (0, swagger_1.ApiCookieAuth)("rezervio_session"),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak aktywnej sesji" }),
    (0, common_1.UseGuards)(auth_guards_1.SessionGuard),
    (0, common_1.Controller)("account"),
    __metadata("design:paramtypes", [account_service_1.AccountService])
], AccountController);
//# sourceMappingURL=account.controller.js.map