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
exports.PublicCalendarController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const calendar_export_service_1 = require("./calendar-export.service");
let PublicCalendarController = class PublicCalendarController {
    exports;
    constructor(exports) {
        this.exports = exports;
    }
    render(token) {
        return this.exports.render(token);
    }
};
exports.PublicCalendarController = PublicCalendarController;
__decorate([
    (0, common_1.Get)("ical/:token.ics"),
    (0, common_1.Header)("content-type", "text/calendar; charset=utf-8"),
    (0, common_1.Header)("cache-control", "no-store"),
    (0, swagger_1.ApiOperation)({
        summary: "Eksport iCal",
        description: "Zwraca wyłącznie blokady ręczne Host. Terminy zaimportowane z innych kalendarzy nigdy nie są eksportowane.",
    }),
    (0, swagger_1.ApiOkResponse)({ description: "Dokument iCalendar" }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Token nieznany albo unieważniony" }),
    __param(0, (0, common_1.Param)("token")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicCalendarController.prototype, "render", null);
exports.PublicCalendarController = PublicCalendarController = __decorate([
    (0, swagger_1.ApiTags)("calendar"),
    (0, common_1.Controller)("calendar"),
    __metadata("design:paramtypes", [calendar_export_service_1.CalendarExportService])
], PublicCalendarController);
//# sourceMappingURL=public-calendar.controller.js.map