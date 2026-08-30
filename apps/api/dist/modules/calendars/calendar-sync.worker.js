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
var CalendarSyncWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarSyncWorker = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const drizzle_orm_1 = require("drizzle-orm");
const queue_module_1 = require("../../infrastructure/queue/queue.module");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const calendar_sync_service_1 = require("./calendar-sync.service");
const SWEEP_JOB = "sweep";
const SYNC_JOB = "sync";
let CalendarSyncWorker = CalendarSyncWorker_1 = class CalendarSyncWorker {
    connection;
    queue;
    database;
    sync;
    config;
    logger = new common_1.Logger(CalendarSyncWorker_1.name);
    worker = null;
    constructor(connection, queue, database, sync, config) {
        this.connection = connection;
        this.queue = queue;
        this.database = database;
        this.sync = sync;
        this.config = config;
    }
    async onModuleInit() {
        if (this.config.get("DISABLE_CALENDAR_WORKER") === "true")
            return;
        this.start();
        await this.scheduleSweep();
    }
    start() {
        if (this.worker?.isRunning())
            return this.worker;
        this.worker = new bullmq_1.Worker(queue_module_1.CALENDAR_SYNC_QUEUE, async (job) => {
            if (job.name === SWEEP_JOB)
                return this.enqueueDueCalendars();
            try {
                return await this.sync.sync(job.data.externalCalendarId);
            }
            catch (error) {
                if (error instanceof calendar_sync_service_1.CalendarSyncError && error.permanent) {
                    throw new bullmq_1.UnrecoverableError(`${error.code}: ${error.message}`);
                }
                throw error;
            }
        }, {
            connection: this.connection,
            concurrency: 2,
            prefix: (0, queue_module_1.queuePrefix)(this.config),
        });
        this.worker.on("failed", (job, error) => {
            this.logger.warn({
                event: "calendar.sync.job_failed",
                jobId: job?.id,
                attempts: job?.attemptsMade,
                errorCode: error instanceof calendar_sync_service_1.CalendarSyncError ? error.code : "UNKNOWN",
            });
        });
        return this.worker;
    }
    async scheduleSweep() {
        const minutes = Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15);
        await this.queue.upsertJobScheduler("calendar-sweep", { every: minutes * 60 * 1000 }, { name: SWEEP_JOB, data: { externalCalendarId: "" } });
    }
    async enqueueDueCalendars() {
        const minutes = Number(this.config.get("ICAL_SYNC_INTERVAL_MINUTES") ?? 15);
        const dueBefore = new Date(Date.now() - minutes * 60 * 1000);
        const due = await this.database.db
            .select({ id: schema_1.externalCalendars.id })
            .from(schema_1.externalCalendars)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.externalCalendars.status, "ACTIVE"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.externalCalendars.lastSyncSucceededAt), (0, drizzle_orm_1.lt)(schema_1.externalCalendars.lastSyncSucceededAt, dueBefore)), (0, drizzle_orm_1.sql) `${schema_1.externalCalendars.consecutiveFailures} < 20`));
        for (const calendar of due) {
            await this.enqueue(calendar.id, false);
        }
        return { enqueued: due.length };
    }
    async enqueue(externalCalendarId, manual) {
        await this.queue.add(SYNC_JOB, { externalCalendarId, manual }, { jobId: `sync-${externalCalendarId}` });
    }
    async onApplicationShutdown() {
        await this.worker?.close();
        this.worker = null;
    }
};
exports.CalendarSyncWorker = CalendarSyncWorker;
exports.CalendarSyncWorker = CalendarSyncWorker = CalendarSyncWorker_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(queue_module_1.REDIS_CONNECTION)),
    __param(1, (0, common_1.Inject)(queue_module_1.SYNC_QUEUE)),
    __param(2, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Function, Function, Object, calendar_sync_service_1.CalendarSyncService,
        config_1.ConfigService])
], CalendarSyncWorker);
//# sourceMappingURL=calendar-sync.worker.js.map