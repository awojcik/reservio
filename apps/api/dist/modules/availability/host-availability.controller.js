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
exports.HostAvailabilityController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const drizzle_orm_1 = require("drizzle-orm");
const auth_guards_1 = require("../auth/auth.guards");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const common_2 = require("@nestjs/common");
const host_properties_service_1 = require("../properties/host/host-properties.service");
const availability_service_1 = require("./availability.service");
const availability_dto_1 = require("./dto/availability.dto");
const SOURCE_LABELS = {
    HOST_BLOCK: "Ręczna blokada",
    EXTERNAL_CALENDAR: "Kalendarz zewnętrzny",
    BOOKING: "Rezerwacja",
    BOOKING_HOLD: "Tymczasowa blokada",
    MAINTENANCE: "Prace serwisowe",
};
let HostAvailabilityController = class HostAvailabilityController {
    availability;
    hostProperties;
    database;
    constructor(availability, hostProperties, database) {
        this.availability = availability;
        this.hostProperties = hostProperties;
        this.database = database;
    }
    async calendar(host, id, window) {
        await this.hostProperties.findOwned(host.id, id);
        const blocks = await this.availability.getBlocks(id, {
            startDate: window.from,
            endDate: window.to,
        });
        const calendarNames = await this.calendarNames(blocks
            .map((block) => block.externalCalendarId)
            .filter((value) => value !== null));
        return {
            propertyId: id,
            from: window.from,
            to: window.to,
            blocks: blocks.map((block) => ({
                id: block.id,
                startDate: block.startDate,
                endDate: block.endDate,
                sourceType: block.sourceType,
                sourceLabel: SOURCE_LABELS[block.sourceType] ?? block.sourceType,
                calendarName: block.externalCalendarId
                    ? (calendarNames.get(block.externalCalendarId) ?? null)
                    : null,
                note: block.note,
            })),
        };
    }
    async block(host, id, dto) {
        await this.hostProperties.findOwned(host.id, id);
        await this.availability.blockDates(id, { startDate: dto.startDate, endDate: dto.endDate }, dto.note ?? null);
        return this.calendar(host, id, { from: dto.startDate, to: dto.endDate });
    }
    async unblock(host, id, dto) {
        await this.hostProperties.findOwned(host.id, id);
        await this.availability.unblockDates(id, {
            startDate: dto.startDate,
            endDate: dto.endDate,
        });
        return this.calendar(host, id, { from: dto.startDate, to: dto.endDate });
    }
    async calendarNames(ids) {
        if (ids.length === 0)
            return new Map();
        const rows = await this.database.db
            .select({ id: schema_1.externalCalendars.id, name: schema_1.externalCalendars.name })
            .from(schema_1.externalCalendars)
            .where((0, drizzle_orm_1.inArray)(schema_1.externalCalendars.id, [...new Set(ids)]));
        return new Map(rows.map((row) => [row.id, row.name]));
    }
};
exports.HostAvailabilityController = HostAvailabilityController;
__decorate([
    (0, common_1.Get)(":id/calendar"),
    (0, swagger_1.ApiOperation)({
        summary: "Kalendarz Property",
        description: "Zwraca zakresy, nie wiersz na każdy dzień. endDate jest exclusive.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: availability_dto_1.HostCalendarDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, availability_dto_1.CalendarWindowDto]),
    __metadata("design:returntype", Promise)
], HostAvailabilityController.prototype, "calendar", null);
__decorate([
    (0, common_1.Post)(":id/availability/block"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Ręczna blokada terminu",
        description: "Tworzy HOST_BLOCK i scala go z przylegającymi oraz nachodzącymi blokadami ręcznymi. Blokad z kalendarzy zewnętrznych nie dotyka.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: availability_dto_1.HostCalendarDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, availability_dto_1.BlockDatesDto]),
    __metadata("design:returntype", Promise)
], HostAvailabilityController.prototype, "block", null);
__decorate([
    (0, common_1.Post)(":id/availability/unblock"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Zdjęcie ręcznej blokady",
        description: "Usuwa, przycina albo dzieli HOST_BLOCK. Nigdy nie usuwa blokad z kalendarzy zewnętrznych.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: availability_dto_1.HostCalendarDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, availability_dto_1.UnblockDatesDto]),
    __metadata("design:returntype", Promise)
], HostAvailabilityController.prototype, "unblock", null);
exports.HostAvailabilityController = HostAvailabilityController = __decorate([
    (0, swagger_1.ApiTags)("host"),
    (0, swagger_1.ApiCookieAuth)("rezervio_session"),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak aktywnej sesji" }),
    (0, swagger_1.ApiForbiddenResponse)({ description: "Konto bez profilu Host" }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Property nie istnieje lub należy do innego Host" }),
    (0, common_1.UseGuards)(auth_guards_1.HostGuard),
    (0, common_1.Controller)("host/properties"),
    __param(2, (0, common_2.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [availability_service_1.AvailabilityService,
        host_properties_service_1.HostPropertiesService, Object])
], HostAvailabilityController);
//# sourceMappingURL=host-availability.controller.js.map