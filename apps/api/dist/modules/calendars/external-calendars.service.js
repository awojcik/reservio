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
var ExternalCalendarsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalCalendarsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const safe_fetch_1 = require("./safe-fetch");
const ical_url_cipher_1 = require("./ical-url-cipher");
let ExternalCalendarsService = ExternalCalendarsService_1 = class ExternalCalendarsService {
    database;
    cipher;
    config;
    logger = new common_1.Logger(ExternalCalendarsService_1.name);
    constructor(database, cipher, config) {
        this.database = database;
        this.cipher = cipher;
        this.config = config;
    }
    get allowPrivateHosts() {
        return this.config.get("ICAL_ALLOW_PRIVATE_HOSTS") === "true";
    }
    async list(propertyId) {
        const rows = await this.database.db
            .select()
            .from(schema_1.externalCalendars)
            .where((0, drizzle_orm_1.eq)(schema_1.externalCalendars.propertyId, propertyId))
            .orderBy(schema_1.externalCalendars.createdAt);
        return Promise.all(rows.map((row) => this.toDto(row)));
    }
    async findOwned(propertyId, calendarId) {
        const [row] = await this.database.db
            .select()
            .from(schema_1.externalCalendars)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.externalCalendars.id, calendarId), (0, drizzle_orm_1.eq)(schema_1.externalCalendars.propertyId, propertyId)))
            .limit(1);
        if (!row)
            throw new common_1.NotFoundException("Nie znaleziono kalendarza.");
        return row;
    }
    async create(propertyId, dto) {
        (0, safe_fetch_1.assertAllowedUrl)(dto.importUrl, this.allowPrivateHosts);
        const [row] = await this.database.db
            .insert(schema_1.externalCalendars)
            .values({
            propertyId,
            provider: dto.provider,
            name: dto.name,
            importUrlEncrypted: this.cipher.encrypt(dto.importUrl),
            status: "ACTIVE",
        })
            .returning();
        this.logger.log({
            event: "calendar.created",
            calendarId: row.id,
            propertyId,
            provider: row.provider,
        });
        return row;
    }
    async update(propertyId, calendarId, dto) {
        const current = await this.findOwned(propertyId, calendarId);
        const patch = { updatedAt: new Date() };
        if (dto.name !== undefined)
            patch.name = dto.name;
        if (dto.importUrl !== undefined) {
            (0, safe_fetch_1.assertAllowedUrl)(dto.importUrl, this.allowPrivateHosts);
            patch.importUrlEncrypted = this.cipher.encrypt(dto.importUrl);
            patch.consecutiveFailures = 0;
            patch.lastErrorCode = null;
            patch.lastErrorMessage = null;
        }
        if (dto.status !== undefined) {
            patch.status = dto.status;
        }
        const [row] = await this.database.db
            .update(schema_1.externalCalendars)
            .set(patch)
            .where((0, drizzle_orm_1.eq)(schema_1.externalCalendars.id, current.id))
            .returning();
        if (dto.status === "DISABLED" && current.status !== "DISABLED") {
            await this.dropImportedBlocks(current.id);
        }
        return row;
    }
    async remove(propertyId, calendarId) {
        const calendar = await this.findOwned(propertyId, calendarId);
        await this.database.db.transaction(async (tx) => {
            await tx
                .delete(schema_1.availabilityBlocks)
                .where((0, drizzle_orm_1.eq)(schema_1.availabilityBlocks.externalCalendarId, calendar.id));
            await tx.delete(schema_1.externalCalendars).where((0, drizzle_orm_1.eq)(schema_1.externalCalendars.id, calendar.id));
        });
        this.logger.log({
            event: "calendar.removed",
            calendarId: calendar.id,
            propertyId,
            provider: calendar.provider,
        });
    }
    async toDto(row) {
        const [{ count }] = (await this.database.db.execute((0, drizzle_orm_1.sql) `
      SELECT count(*)::int AS count FROM availability_blocks
      WHERE external_calendar_id = ${row.id}
    `));
        return {
            id: row.id,
            provider: row.provider,
            name: row.name,
            maskedUrl: this.maskedUrl(row.importUrlEncrypted),
            status: row.status,
            lastSyncSucceededAt: row.lastSyncSucceededAt?.toISOString() ?? null,
            lastSyncFailedAt: row.lastSyncFailedAt?.toISOString() ?? null,
            lastErrorCode: row.lastErrorCode,
            lastErrorMessage: row.lastErrorMessage,
            consecutiveFailures: row.consecutiveFailures,
            importedBlockCount: count,
        };
    }
    maskedUrl(encrypted) {
        try {
            return ical_url_cipher_1.IcalUrlCipher.mask(this.cipher.decrypt(encrypted));
        }
        catch {
            return "…";
        }
    }
    async dropImportedBlocks(calendarId) {
        await this.database.db
            .delete(schema_1.availabilityBlocks)
            .where((0, drizzle_orm_1.eq)(schema_1.availabilityBlocks.externalCalendarId, calendarId));
    }
};
exports.ExternalCalendarsService = ExternalCalendarsService;
exports.ExternalCalendarsService = ExternalCalendarsService = ExternalCalendarsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object, ical_url_cipher_1.IcalUrlCipher,
        config_1.ConfigService])
], ExternalCalendarsService);
//# sourceMappingURL=external-calendars.service.js.map