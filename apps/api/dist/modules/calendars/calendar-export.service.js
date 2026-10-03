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
var CalendarExportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarExportService = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const TOKEN_BYTES = 32;
function hashToken(token) {
    return (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
}
let CalendarExportService = CalendarExportService_1 = class CalendarExportService {
    database;
    logger = new common_1.Logger(CalendarExportService_1.name);
    constructor(database) {
        this.database = database;
    }
    async issue(propertyId) {
        const token = (0, node_crypto_1.randomBytes)(TOKEN_BYTES).toString("base64url");
        const createdAt = await this.database.db.transaction(async (tx) => {
            await tx
                .update(schema_1.calendarExportTokens)
                .set({ revokedAt: new Date() })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.calendarExportTokens.propertyId, propertyId), (0, drizzle_orm_1.isNull)(schema_1.calendarExportTokens.revokedAt)));
            const [row] = await tx
                .insert(schema_1.calendarExportTokens)
                .values({ propertyId, tokenHash: hashToken(token) })
                .returning({ createdAt: schema_1.calendarExportTokens.createdAt });
            return row.createdAt;
        });
        this.logger.log({ event: "calendar.export.issued", propertyId });
        return { token, createdAt };
    }
    async revoke(propertyId) {
        await this.database.db
            .update(schema_1.calendarExportTokens)
            .set({ revokedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.calendarExportTokens.propertyId, propertyId), (0, drizzle_orm_1.isNull)(schema_1.calendarExportTokens.revokedAt)));
        this.logger.log({ event: "calendar.export.revoked", propertyId });
    }
    async status(propertyId) {
        const [row] = await this.database.db
            .select({ createdAt: schema_1.calendarExportTokens.createdAt })
            .from(schema_1.calendarExportTokens)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.calendarExportTokens.propertyId, propertyId), (0, drizzle_orm_1.isNull)(schema_1.calendarExportTokens.revokedAt)))
            .limit(1);
        return { active: Boolean(row), createdAt: row?.createdAt ?? null };
    }
    async render(token) {
        const [row] = await this.database.db
            .select({
            propertyId: schema_1.calendarExportTokens.propertyId,
            title: schema_1.properties.title,
        })
            .from(schema_1.calendarExportTokens)
            .innerJoin(schema_1.properties, (0, drizzle_orm_1.eq)(schema_1.properties.id, schema_1.calendarExportTokens.propertyId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.calendarExportTokens.tokenHash, hashToken(token)), (0, drizzle_orm_1.isNull)(schema_1.calendarExportTokens.revokedAt)))
            .limit(1);
        if (!row)
            throw new common_1.NotFoundException("Nieznany albo unieważniony token eksportu.");
        const blocks = (await this.database.db.execute((0, drizzle_orm_1.sql) `
      SELECT id,
             lower(date_range)::text AS start_date,
             upper(date_range)::text AS end_date
      FROM availability_blocks
      WHERE property_id = ${row.propertyId}
        AND source_type = 'HOST_BLOCK'
      ORDER BY lower(date_range) ASC
    `));
        return this.toIcal(blocks.map((block) => ({
            id: block.id,
            startDate: block.start_date,
            endDate: block.end_date,
        })));
    }
    toIcal(blocks) {
        const lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Rezervio//Availability//PL",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
        ];
        for (const block of blocks) {
            lines.push("BEGIN:VEVENT", `UID:availability-block-${block.id}@rezervio`, `DTSTART;VALUE=DATE:${compact(block.startDate)}`, `DTEND;VALUE=DATE:${compact(block.endDate)}`, "SUMMARY:Unavailable", "END:VEVENT");
        }
        lines.push("END:VCALENDAR");
        return `${lines.join("\r\n")}\r\n`;
    }
};
exports.CalendarExportService = CalendarExportService;
exports.CalendarExportService = CalendarExportService = CalendarExportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], CalendarExportService);
function compact(date) {
    return date.replace(/-/g, "");
}
//# sourceMappingURL=calendar-export.service.js.map