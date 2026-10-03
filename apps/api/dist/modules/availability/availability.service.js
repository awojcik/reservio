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
var AvailabilityService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvailabilityService = void 0;
exports.rangeLiteral = rangeLiteral;
exports.acquirePropertyLock = acquirePropertyLock;
exports.overlapCondition = overlapCondition;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const availability_1 = require("../../domain/availability");
function rangeLiteral(range) {
    return (0, drizzle_orm_1.sql) `daterange(${range.startDate}::date, ${range.endDate}::date, '[)')`;
}
const PROPERTY_LOCK_NAMESPACE = 4231;
async function acquirePropertyLock(tx, propertyId) {
    await tx.execute((0, drizzle_orm_1.sql) `SELECT pg_advisory_xact_lock(${PROPERTY_LOCK_NAMESPACE}, hashtext(${propertyId}))`);
}
const LIVE_BLOCK_PREDICATE = (0, drizzle_orm_1.sql) `(
  ab.booking_hold_id IS NULL
  OR (bh.status = 'ACTIVE' AND bh.expires_at > now())
)`;
function overlapCondition(alias, range) {
    return (0, drizzle_orm_1.sql) `EXISTS (
    SELECT 1 FROM availability_blocks ab
    LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
    WHERE ab.property_id = ${drizzle_orm_1.sql.raw(alias)}.id
      AND ab.date_range && ${rangeLiteral(range)}
      AND ${LIVE_BLOCK_PREDICATE}
  )`;
}
let AvailabilityService = AvailabilityService_1 = class AvailabilityService {
    database;
    logger = new common_1.Logger(AvailabilityService_1.name);
    constructor(database) {
        this.database = database;
    }
    async isAvailable(propertyId, stay) {
        (0, availability_1.assertValidRange)(stay);
        return this.isAvailableWithin(this.database.db, propertyId, stay);
    }
    async isAvailableWithin(executor, propertyId, stay) {
        (0, availability_1.assertValidRange)(stay);
        const rows = (await executor.execute((0, drizzle_orm_1.sql) `
      SELECT 1 AS blocked
      FROM availability_blocks ab
      LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
      WHERE ab.property_id = ${propertyId}
        AND ab.date_range && ${rangeLiteral(stay)}
        AND ${LIVE_BLOCK_PREDICATE}
      LIMIT 1
    `));
        return rows.length === 0;
    }
    async getBlocks(propertyId, window, executor = this.database.db) {
        (0, availability_1.assertValidRange)(window);
        const rows = (await executor.execute((0, drizzle_orm_1.sql) `
      SELECT ab.id,
             lower(ab.date_range)::text AS start_date,
             upper(ab.date_range)::text AS end_date,
             ab.source_type,
             ab.external_calendar_id,
             ab.external_event_uid,
             ab.note
      FROM availability_blocks ab
      LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
      WHERE ab.property_id = ${propertyId}
        AND ab.date_range && ${rangeLiteral(window)}
        AND ${LIVE_BLOCK_PREDICATE}
      ORDER BY lower(ab.date_range) ASC
    `));
        return rows.map((row) => ({
            id: row.id,
            startDate: row.start_date,
            endDate: row.end_date,
            sourceType: row.source_type,
            externalCalendarId: row.external_calendar_id,
            externalEventUid: row.external_event_uid,
            note: row.note,
        }));
    }
    async blockDates(propertyId, range, note) {
        (0, availability_1.assertValidRange)(range);
        await this.database.db.transaction(async (tx) => {
            await acquirePropertyLock(tx, propertyId);
            const neighbours = (await tx.execute((0, drizzle_orm_1.sql) `
        SELECT id,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date,
               note
        FROM availability_blocks
        WHERE property_id = ${propertyId}
          AND source_type = 'HOST_BLOCK'
          AND date_range && daterange(
                (${range.startDate}::date - 1),
                (${range.endDate}::date + 1),
                '[)'
              )
        FOR UPDATE
      `));
            const pieces = [
                range,
                ...neighbours.map((row) => ({
                    startDate: row.start_date,
                    endDate: row.end_date,
                })),
            ];
            const [merged] = (0, availability_1.mergeRanges)(pieces);
            const survivingNote = note ?? neighbours.find((row) => row.note !== null)?.note ?? null;
            if (neighbours.length > 0) {
                await tx.execute((0, drizzle_orm_1.sql) `
          DELETE FROM availability_blocks
          WHERE id IN (${drizzle_orm_1.sql.join(neighbours.map((row) => (0, drizzle_orm_1.sql) `${row.id}::uuid`), (0, drizzle_orm_1.sql) `, `)})
        `);
            }
            await tx.execute((0, drizzle_orm_1.sql) `
        INSERT INTO availability_blocks (property_id, source_type, date_range, note)
        VALUES (${propertyId}, 'HOST_BLOCK', ${rangeLiteral(merged)}, ${survivingNote})
      `);
        });
        this.logger.log({
            event: "availability.blocked",
            propertyId,
            startDate: range.startDate,
            endDate: range.endDate,
        });
        return this.getBlocks(propertyId, range);
    }
    async unblockDates(propertyId, range) {
        (0, availability_1.assertValidRange)(range);
        await this.database.db.transaction(async (tx) => {
            await acquirePropertyLock(tx, propertyId);
            const affected = (await tx.execute((0, drizzle_orm_1.sql) `
        SELECT id,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date,
               note
        FROM availability_blocks
        WHERE property_id = ${propertyId}
          AND source_type = 'HOST_BLOCK'
          AND date_range && ${rangeLiteral(range)}
        FOR UPDATE
      `));
            if (affected.length === 0)
                return;
            await tx.execute((0, drizzle_orm_1.sql) `
        DELETE FROM availability_blocks
        WHERE id IN (${drizzle_orm_1.sql.join(affected.map((row) => (0, drizzle_orm_1.sql) `${row.id}::uuid`), (0, drizzle_orm_1.sql) `, `)})
      `);
            for (const row of affected) {
                const remainder = (0, availability_1.subtractRange)({ startDate: row.start_date, endDate: row.end_date }, range);
                for (const piece of remainder) {
                    await tx.execute((0, drizzle_orm_1.sql) `
            INSERT INTO availability_blocks (property_id, source_type, date_range, note)
            VALUES (${propertyId}, 'HOST_BLOCK', ${rangeLiteral(piece)}, ${row.note})
          `);
                }
            }
        });
        this.logger.log({
            event: "availability.unblocked",
            propertyId,
            startDate: range.startDate,
            endDate: range.endDate,
        });
        return this.getBlocks(propertyId, range);
    }
    async reconcileExternalBlocks(propertyId, externalCalendarId, events, horizon) {
        return this.database.db.transaction(async (tx) => {
            await acquirePropertyLock(tx, propertyId);
            const existing = (await tx.execute((0, drizzle_orm_1.sql) `
        SELECT id, external_event_uid,
               lower(date_range)::text AS start_date,
               upper(date_range)::text AS end_date
        FROM availability_blocks
        WHERE external_calendar_id = ${externalCalendarId}
        FOR UPDATE
      `));
            const byUid = new Map(existing.map((row) => [row.external_event_uid, row]));
            const incoming = new Map(events.map((event) => [event.uid, event.range]));
            let inserted = 0;
            let updated = 0;
            for (const [uid, range] of incoming) {
                const current = byUid.get(uid);
                if (!current) {
                    await tx.execute((0, drizzle_orm_1.sql) `
            INSERT INTO availability_blocks
              (property_id, source_type, date_range, external_calendar_id, external_event_uid)
            VALUES (${propertyId}, 'EXTERNAL_CALENDAR', ${rangeLiteral(range)},
                    ${externalCalendarId}, ${uid})
          `);
                    inserted += 1;
                    continue;
                }
                if (current.start_date !== range.startDate || current.end_date !== range.endDate) {
                    await tx.execute((0, drizzle_orm_1.sql) `
            UPDATE availability_blocks
            SET date_range = ${rangeLiteral(range)}, updated_at = now()
            WHERE id = ${current.id}
          `);
                    updated += 1;
                }
            }
            const removable = existing.filter((row) => !incoming.has(row.external_event_uid ?? "") &&
                row.start_date < horizon.endDate &&
                horizon.startDate < row.end_date);
            if (removable.length > 0) {
                await tx.execute((0, drizzle_orm_1.sql) `
          DELETE FROM availability_blocks
          WHERE id IN (${drizzle_orm_1.sql.join(removable.map((row) => (0, drizzle_orm_1.sql) `${row.id}::uuid`), (0, drizzle_orm_1.sql) `, `)})
        `);
            }
            return { inserted, updated, deleted: removable.length };
        });
    }
    async deleteExternalBlocks(externalCalendarId, executor = this.database.db) {
        await executor
            .delete(schema_1.availabilityBlocks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.availabilityBlocks.externalCalendarId, externalCalendarId), (0, drizzle_orm_1.eq)(schema_1.availabilityBlocks.sourceType, "EXTERNAL_CALENDAR")));
    }
};
exports.AvailabilityService = AvailabilityService;
exports.AvailabilityService = AvailabilityService = AvailabilityService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], AvailabilityService);
//# sourceMappingURL=availability.service.js.map