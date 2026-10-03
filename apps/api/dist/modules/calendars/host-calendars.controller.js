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
exports.HostCalendarsController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const swagger_1 = require("@nestjs/swagger");
const auth_guards_1 = require("../auth/auth.guards");
const host_properties_service_1 = require("../properties/host/host-properties.service");
const calendar_export_service_1 = require("./calendar-export.service");
const calendar_sync_worker_1 = require("./calendar-sync.worker");
const external_calendars_service_1 = require("./external-calendars.service");
const external_calendar_dto_1 = require("./dto/external-calendar.dto");
let HostCalendarsController = class HostCalendarsController {
    calendars;
    exports;
    worker;
    hostProperties;
    config;
    constructor(calendars, exports, worker, hostProperties, config) {
        this.calendars = calendars;
        this.exports = exports;
        this.worker = worker;
        this.hostProperties = hostProperties;
        this.config = config;
    }
    async list(host, id) {
        await this.hostProperties.findOwned(host.id, id);
        return this.calendars.list(id);
    }
    async create(host, id, dto) {
        await this.hostProperties.findOwned(host.id, id);
        const calendar = await this.calendars.create(id, dto);
        await this.worker.enqueue(calendar.id, true);
        return this.calendars.toDto(calendar);
    }
    async update(host, id, calendarId, dto) {
        await this.hostProperties.findOwned(host.id, id);
        const calendar = await this.calendars.update(id, calendarId, dto);
        if (dto.importUrl !== undefined && calendar.status === "ACTIVE") {
            await this.worker.enqueue(calendar.id, true);
        }
        return this.calendars.toDto(calendar);
    }
    async remove(host, id, calendarId) {
        await this.hostProperties.findOwned(host.id, id);
        await this.calendars.remove(id, calendarId);
    }
    async syncNow(host, id, calendarId) {
        await this.hostProperties.findOwned(host.id, id);
        const calendar = await this.calendars.findOwned(id, calendarId);
        await this.worker.enqueue(calendar.id, true);
        return { status: "QUEUED" };
    }
    async exportStatus(host, id) {
        await this.hostProperties.findOwned(host.id, id);
        const status = await this.exports.status(id);
        return { active: status.active, createdAt: status.createdAt?.toISOString() ?? null };
    }
    create_export(host, id) {
        return this.issueToken(host, id);
    }
    regenerate(host, id) {
        return this.issueToken(host, id);
    }
    async revoke(host, id) {
        await this.hostProperties.findOwned(host.id, id);
        await this.exports.revoke(id);
    }
    async issueToken(host, id) {
        await this.hostProperties.findOwned(host.id, id);
        const { token, createdAt } = await this.exports.issue(id);
        const base = (this.config.get("PUBLIC_API_URL") ?? "http://localhost:3001/api")
            .replace(/\/$/, "");
        return { url: `${base}/calendar/ical/${token}.ics`, createdAt: createdAt.toISOString() };
    }
};
exports.HostCalendarsController = HostCalendarsController;
__decorate([
    (0, common_1.Get)(":id/external-calendars"),
    (0, swagger_1.ApiOperation)({
        summary: "Kalendarze zewnętrzne Property",
        description: "Adres feedu zwracany jest wyłącznie w formie zamaskowanej.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: [external_calendar_dto_1.ExternalCalendarDto] }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(":id/external-calendars"),
    (0, swagger_1.ApiOperation)({
        summary: "Podpięcie feedu iCal",
        description: "Adres jest walidowany, szyfrowany i zapisywany, a pierwsza synchronizacja trafia do kolejki.",
    }),
    (0, swagger_1.ApiCreatedResponse)({ type: external_calendar_dto_1.ExternalCalendarDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, external_calendar_dto_1.CreateExternalCalendarDto]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id/external-calendars/:calendarId"),
    (0, swagger_1.ApiOperation)({
        summary: "Edycja kalendarza",
        description: "Wyłączenie kalendarza usuwa zaimportowane przez niego terminy; blokad ręcznych nie rusza.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: external_calendar_dto_1.ExternalCalendarDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)("calendarId", common_1.ParseUUIDPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, external_calendar_dto_1.UpdateExternalCalendarDto]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id/external-calendars/:calendarId"),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({
        summary: "Odpięcie kalendarza",
        description: "Usuwa kalendarz razem z zaimportowanymi terminami.",
    }),
    (0, swagger_1.ApiNoContentResponse)(),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)("calendarId", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(":id/external-calendars/:calendarId/sync"),
    (0, common_1.HttpCode)(202),
    (0, swagger_1.ApiOperation)({
        summary: "Synchronizuj teraz",
        description: "Zadanie trafia do kolejki. Feed nie jest pobierany w wątku żądania, a ponowne kliknięcia są deduplikowane.",
    }),
    (0, swagger_1.ApiAcceptedResponse)({ description: "Synchronizacja zakolejkowana" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)("calendarId", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "syncNow", null);
__decorate([
    (0, common_1.Get)(":id/calendar-export"),
    (0, swagger_1.ApiOperation)({ summary: "Stan adresu eksportu" }),
    (0, swagger_1.ApiOkResponse)({ type: external_calendar_dto_1.CalendarExportStatusDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "exportStatus", null);
__decorate([
    (0, common_1.Post)(":id/calendar-export"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Wygenerowanie adresu eksportu",
        description: "Pełny adres zwracany jest tylko teraz — później dostępny jest wyłącznie stan.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: external_calendar_dto_1.CalendarExportTokenDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "create_export", null);
__decorate([
    (0, common_1.Post)(":id/calendar-export/regenerate"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Rotacja adresu eksportu",
        description: "Poprzedni adres natychmiast przestaje działać.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: external_calendar_dto_1.CalendarExportTokenDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "regenerate", null);
__decorate([
    (0, common_1.Delete)(":id/calendar-export"),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({ summary: "Unieważnienie adresu eksportu" }),
    (0, swagger_1.ApiNoContentResponse)(),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostCalendarsController.prototype, "revoke", null);
exports.HostCalendarsController = HostCalendarsController = __decorate([
    (0, swagger_1.ApiTags)("host"),
    (0, swagger_1.ApiCookieAuth)("rezervio_session"),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak aktywnej sesji" }),
    (0, swagger_1.ApiForbiddenResponse)({ description: "Konto bez profilu Host" }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Property nie istnieje lub należy do innego Host" }),
    (0, common_1.UseGuards)(auth_guards_1.HostGuard),
    (0, common_1.Controller)("host/properties"),
    __metadata("design:paramtypes", [external_calendars_service_1.ExternalCalendarsService,
        calendar_export_service_1.CalendarExportService,
        calendar_sync_worker_1.CalendarSyncWorker,
        host_properties_service_1.HostPropertiesService,
        config_1.ConfigService])
], HostCalendarsController);
//# sourceMappingURL=host-calendars.controller.js.map