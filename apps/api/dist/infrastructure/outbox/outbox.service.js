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
var OutboxService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../database/database.module");
const schema_1 = require("../database/schema");
let OutboxService = OutboxService_1 = class OutboxService {
    database;
    logger = new common_1.Logger(OutboxService_1.name);
    constructor(database) {
        this.database = database;
    }
    async record(executor, event) {
        await executor.insert(schema_1.outboxEvents).values({
            type: event.type,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payloadJson: JSON.stringify(event.payload),
        });
    }
    async claimPending(limit = 50) {
        return this.database.db.transaction(async (tx) => {
            const rows = (await tx.execute((0, drizzle_orm_1.sql) `
        SELECT id, type, aggregate_id, payload_json
        FROM outbox_events
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `));
            if (rows.length === 0)
                return [];
            await tx.execute((0, drizzle_orm_1.sql) `
        UPDATE outbox_events
        SET status = 'PROCESSING', attempt_count = attempt_count + 1
        WHERE id IN (${drizzle_orm_1.sql.join(rows.map((row) => (0, drizzle_orm_1.sql) `${row.id}::uuid`), (0, drizzle_orm_1.sql) `, `)})
      `);
            return rows.map((row) => ({
                id: row.id,
                type: row.type,
                aggregateId: row.aggregate_id,
                payload: JSON.parse(row.payload_json),
            }));
        });
    }
    async markProcessed(id) {
        await this.database.db
            .update(schema_1.outboxEvents)
            .set({ status: "PROCESSED", processedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.outboxEvents.id, id));
    }
    async markFailed(id, error) {
        await this.database.db
            .update(schema_1.outboxEvents)
            .set({ status: "PENDING", lastError: error.slice(0, 500) })
            .where((0, drizzle_orm_1.eq)(schema_1.outboxEvents.id, id));
        this.logger.warn({ event: "outbox.enqueue_failed", outboxId: id });
    }
    async recoverStale(olderThanMs = 5 * 60 * 1000) {
        const rows = (await this.database.db.execute((0, drizzle_orm_1.sql) `
      UPDATE outbox_events
      SET status = 'PENDING'
      WHERE status = 'PROCESSING'
        AND created_at < now() - ${drizzle_orm_1.sql.raw(`interval '${Math.round(olderThanMs / 1000)} seconds'`)}
      RETURNING id
    `));
        return rows.length;
    }
};
exports.OutboxService = OutboxService;
exports.OutboxService = OutboxService = OutboxService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], OutboxService);
//# sourceMappingURL=outbox.service.js.map