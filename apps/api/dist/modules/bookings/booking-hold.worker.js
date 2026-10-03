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
var BookingHoldWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingHoldWorker = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const drizzle_orm_1 = require("drizzle-orm");
const queue_module_1 = require("../../infrastructure/queue/queue.module");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const payment_cancel_scheduler_1 = require("../payments/payment-cancel.scheduler");
const bookings_service_1 = require("./bookings.service");
const SWEEP_JOB = "sweep";
let BookingHoldWorker = BookingHoldWorker_1 = class BookingHoldWorker {
    connection;
    queue;
    database;
    bookings;
    paymentCancels;
    config;
    logger = new common_1.Logger(BookingHoldWorker_1.name);
    worker = null;
    constructor(connection, queue, database, bookings, paymentCancels, config) {
        this.connection = connection;
        this.queue = queue;
        this.database = database;
        this.bookings = bookings;
        this.paymentCancels = paymentCancels;
        this.config = config;
    }
    async onModuleInit() {
        if (this.config.get("DISABLE_BOOKING_WORKER") === "true")
            return;
        this.start();
        await this.scheduleSweep();
    }
    async scheduleSweep() {
        const minutes = Number(this.config.get("BOOKING_HOLD_SWEEP_MINUTES") ?? 5);
        await this.queue.upsertJobScheduler("booking-hold-sweep", { every: minutes * 60 * 1000 }, { name: SWEEP_JOB, data: { holdId: "" } });
    }
    start() {
        if (this.worker?.isRunning())
            return this.worker;
        this.worker = new bullmq_1.Worker(queue_module_1.BOOKING_HOLD_QUEUE, async (job) => {
            if (job.name === SWEEP_JOB)
                return this.sweepExpired();
            return this.expire(job.data.holdId);
        }, {
            connection: this.connection,
            concurrency: (0, queue_module_1.workerConcurrency)(this.config, 4),
            prefix: (0, queue_module_1.queuePrefix)(this.config),
        });
        this.worker.on("failed", (job, error) => {
            this.logger.warn({
                event: "booking.hold.expire_failed",
                jobId: job?.id,
                attempts: job?.attemptsMade,
                reason: error.message,
            });
        });
        return this.worker;
    }
    async scheduleExpiry(holdId, expiresAt) {
        await this.queue.add("expire", { holdId }, {
            jobId: `booking-hold-expire-${holdId}`,
            delay: Math.max(0, expiresAt.getTime() - Date.now()),
        });
    }
    async expire(holdId) {
        const hold = await this.database.db
            .select({ bookingId: schema_1.bookingHolds.bookingId })
            .from(schema_1.bookingHolds)
            .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.id, holdId))
            .limit(1);
        const result = await this.bookings.expireBookingHold(holdId);
        if (result.expired && hold[0]) {
            await this.paymentCancels.cancelOpenPayments(hold[0].bookingId);
        }
        return result;
    }
    async sweepExpired() {
        const due = await this.database.db
            .select({ id: schema_1.bookingHolds.id })
            .from(schema_1.bookingHolds)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingHolds.status, "ACTIVE"), (0, drizzle_orm_1.lt)(schema_1.bookingHolds.expiresAt, new Date())));
        let expired = 0;
        for (const hold of due) {
            const result = await this.expire(hold.id);
            if (result.expired)
                expired += 1;
        }
        return { expired };
    }
    async onApplicationShutdown() {
        await this.worker?.close();
        this.worker = null;
    }
};
exports.BookingHoldWorker = BookingHoldWorker;
exports.BookingHoldWorker = BookingHoldWorker = BookingHoldWorker_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(queue_module_1.REDIS_CONNECTION)),
    __param(1, (0, common_1.Inject)(queue_module_1.HOLD_QUEUE)),
    __param(2, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Function, Function, Object, bookings_service_1.BookingsService,
        payment_cancel_scheduler_1.PaymentCancelScheduler,
        config_1.ConfigService])
], BookingHoldWorker);
//# sourceMappingURL=booking-hold.worker.js.map