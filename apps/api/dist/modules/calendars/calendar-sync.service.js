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
var CalendarSyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarSyncService = exports.CalendarSyncError = exports.PERMANENT_ERROR_CODES = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const availability_1 = require("../../domain/availability");
const availability_service_1 = require("../availability/availability.service");
const ical_url_cipher_1 = require("./ical-url-cipher");
const ical_parser_1 = require("./ical-parser");
const safe_fetch_1 = require("./safe-fetch");
exports.PERMANENT_ERROR_CODES = new Set([
    "SECURITY_REJECTED",
    "PARSE_ERROR",
    "DECRYPT_ERROR",
    "CALENDAR_MISSING",
]);
class CalendarSyncError extends Error {
    code;
    permanent;
    constructor(message, code, permanent) {
        super(message);
        this.code = code;
        this.permanent = permanent;
    }
}
exports.CalendarSyncError = CalendarSyncError;
let CalendarSyncService = CalendarSyncService_1 = class CalendarSyncService {
    database;
    availability;
    cipher;
    config;
    logger = new common_1.Logger(CalendarSyncService_1.name);
    constructor(database, availability, cipher, config) {
        this.database = database;
        this.availability = availability;
        this.cipher = cipher;
        this.config = config;
    }
    async sync(externalCalendarId) {
        const startedAt = Date.now();
        const [calendar] = await this.database.db
            .select()
            .from(schema_1.externalCalendars)
            .where((0, drizzle_orm_1.eq)(schema_1.externalCalendars.id, externalCalendarId))
            .limit(1);
        if (!calendar) {
            throw new CalendarSyncError("Kalendarz nie istnieje.", "CALENDAR_MISSING", true);
        }
        const [property] = await this.database.db
            .select({ id: schema_1.properties.id, timeZone: schema_1.properties.timeZone })
            .from(schema_1.properties)
            .where((0, drizzle_orm_1.eq)(schema_1.properties.id, calendar.propertyId))
            .limit(1);
        if (!property) {
            throw new CalendarSyncError("Property nie istnieje.", "CALENDAR_MISSING", true);
        }
        await this.database.db
            .update(schema_1.externalCalendars)
            .set({ lastSyncStartedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.externalCalendars.id, calendar.id));
        this.logger.log({
            event: "calendar.sync.started",
            calendarId: calendar.id,
            propertyId: property.id,
            provider: calendar.provider,
        });
        try {
            const url = this.decryptUrl(calendar.importUrlEncrypted);
            const horizon = this.horizonFor(property.timeZone);
            const { body } = await (0, safe_fetch_1.safeFetchIcal)(url, {
                timeoutMs: Number(this.config.get("ICAL_FETCH_TIMEOUT_MS") ?? 10_000),
                maxBytes: Number(this.config.get("ICAL_MAX_RESPONSE_BYTES") ?? 5_242_880),
                maxRedirects: 3,
                allowPrivateHosts: this.config.get("ICAL_ALLOW_PRIVATE_HOSTS") === "true",
            });
            const parsed = (0, ical_parser_1.parseIcal)(body, property.timeZone);
            const withinHorizon = parsed.events.filter((event) => event.range.startDate < horizon.endDate && horizon.startDate < event.range.endDate);
            const result = await this.availability.reconcileExternalBlocks(property.id, calendar.id, withinHorizon, horizon);
            await this.database.db
                .update(schema_1.externalCalendars)
                .set({
                lastSyncSucceededAt: new Date(),
                lastErrorCode: null,
                lastErrorMessage: null,
                consecutiveFailures: 0,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.externalCalendars.id, calendar.id));
            this.logger.log({
                event: "calendar.sync.succeeded",
                calendarId: calendar.id,
                propertyId: property.id,
                provider: calendar.provider,
                durationMs: Date.now() - startedAt,
                eventCount: withinHorizon.length,
                ...result,
            });
            this.logger.log({
                event: "calendar.sync.events_imported",
                calendarId: calendar.id,
                eventCount: withinHorizon.length,
                skipped: parsed.skipped.length,
            });
            return { ...result, skipped: parsed.skipped.length };
        }
        catch (error) {
            const failure = this.classify(error);
            await this.recordFailure(calendar.id, failure);
            this.logger.warn({
                event: failure.code === "SECURITY_REJECTED"
                    ? "calendar.sync.security_rejected"
                    : "calendar.sync.failed",
                calendarId: calendar.id,
                propertyId: property.id,
                provider: calendar.provider,
                durationMs: Date.now() - startedAt,
                errorCode: failure.code,
            });
            throw failure;
        }
    }
    horizonFor(timeZone) {
        const now = (0, availability_1.today)(timeZone);
        return { startDate: (0, availability_1.addDays)(now, -30), endDate: (0, availability_1.addDays)(now, 540) };
    }
    decryptUrl(encrypted) {
        try {
            return this.cipher.decrypt(encrypted);
        }
        catch {
            throw new CalendarSyncError("Nie udało się odszyfrować adresu kalendarza.", "DECRYPT_ERROR", true);
        }
    }
    classify(error) {
        if (error instanceof CalendarSyncError)
            return error;
        if (error instanceof safe_fetch_1.UnsafeUrlError) {
            return new CalendarSyncError(error.message, "SECURITY_REJECTED", true);
        }
        if (error instanceof ical_parser_1.IcalParseError) {
            return new CalendarSyncError(error.message, "PARSE_ERROR", true);
        }
        if (error instanceof safe_fetch_1.FetchFailedError) {
            return new CalendarSyncError(error.message, error.code, exports.PERMANENT_ERROR_CODES.has(error.code));
        }
        return new CalendarSyncError(error.message, "UNKNOWN", false);
    }
    async recordFailure(calendarId, failure) {
        await this.database.db.execute((0, drizzle_orm_1.sql) `
      UPDATE external_calendars
      SET last_sync_failed_at = now(),
          last_error_code = ${failure.code},
          last_error_message = ${failure.message.slice(0, 500)},
          consecutive_failures = consecutive_failures + 1,
          updated_at = now()
      WHERE id = ${calendarId}
    `);
    }
};
exports.CalendarSyncService = CalendarSyncService;
exports.CalendarSyncService = CalendarSyncService = CalendarSyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object, availability_service_1.AvailabilityService,
        ical_url_cipher_1.IcalUrlCipher,
        config_1.ConfigService])
], CalendarSyncService);
//# sourceMappingURL=calendar-sync.service.js.map