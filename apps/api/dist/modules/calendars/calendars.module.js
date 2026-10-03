"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarsModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const availability_core_module_1 = require("../availability/availability-core.module");
const properties_module_1 = require("../properties/properties.module");
const calendar_export_service_1 = require("./calendar-export.service");
const calendar_sync_service_1 = require("./calendar-sync.service");
const calendar_sync_worker_1 = require("./calendar-sync.worker");
const external_calendars_service_1 = require("./external-calendars.service");
const host_calendars_controller_1 = require("./host-calendars.controller");
const ical_url_cipher_1 = require("./ical-url-cipher");
const public_calendar_controller_1 = require("./public-calendar.controller");
let CalendarsModule = class CalendarsModule {
};
exports.CalendarsModule = CalendarsModule;
exports.CalendarsModule = CalendarsModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, properties_module_1.PropertiesModule, availability_core_module_1.AvailabilityCoreModule],
        controllers: [host_calendars_controller_1.HostCalendarsController, public_calendar_controller_1.PublicCalendarController],
        providers: [
            external_calendars_service_1.ExternalCalendarsService,
            calendar_sync_service_1.CalendarSyncService,
            calendar_sync_worker_1.CalendarSyncWorker,
            calendar_export_service_1.CalendarExportService,
            ical_url_cipher_1.IcalUrlCipher,
        ],
        exports: [calendar_sync_service_1.CalendarSyncService, calendar_sync_worker_1.CalendarSyncWorker, ical_url_cipher_1.IcalUrlCipher],
    })
], CalendarsModule);
//# sourceMappingURL=calendars.module.js.map