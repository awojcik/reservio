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
var BookingLifecycleWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingLifecycleWorker = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const drizzle_orm_1 = require("drizzle-orm");
const queue_module_1 = require("../../infrastructure/queue/queue.module");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const bookings_service_1 = require("./bookings.service");
const notification_worker_1 = require("../notifications/application/notification.worker");
const EXPIRE_JOB = "expire";
const REMINDER_JOB = "reminder";
const SWEEP_JOB = "sweep";
let BookingLifecycleWorker = BookingLifecycleWorker_1 = class BookingLifecycleWorker {
    connection;
    queue;
    database;
    bookingsService;
    notifications;
    config;
    logger = new common_1.Logger(BookingLifecycleWorker_1.name);
    worker = null;
    constructor(connection, queue, database, bookingsService, notifications, config) {
        this.connection = connection;
        this.queue = queue;
        this.database = database;
        this.bookingsService = bookingsService;
        this.notifications = notifications;
        this.config = config;
    }
    async onModuleInit() {
        if (this.config.get("DISABLE_BOOKING_WORKER") === "true")
            return;
        this.start();
        await this.scheduleSweep();
    }
    start() {
        if (this.worker?.isRunning())
            return this.worker;
        this.worker = new bullmq_1.Worker(queue_module_1.BOOKING_LIFECYCLE_QUEUE, async (job) => {
            if (job.name === SWEEP_JOB)
                return this.sweep();
            if (job.name === REMINDER_JOB)
                return this.sendReminder(job.data.bookingId);
            return this.bookingsService.expireBookingRequest(job.data.bookingId);
        }, { connection: this.connection, concurrency: 4, prefix: (0, queue_module_1.queuePrefix)(this.config) });
        return this.worker;
    }
    async scheduleRequest(bookingId, deadlineAt) {
        const remindBefore = Number(this.config.get("BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY") ?? 14_400);
        const remindDelay = deadlineAt.getTime() - remindBefore * 1000 - Date.now();
        if (remindDelay > 0) {
            await this.queue.add(REMINDER_JOB, { bookingId }, { jobId: `booking-request-reminder-${bookingId}`, delay: remindDelay });
        }
        await this.queue.add(EXPIRE_JOB, { bookingId }, {
            jobId: `booking-request-expire-${bookingId}`,
            delay: Math.max(0, deadlineAt.getTime() - Date.now()),
        });
    }
    async sendReminder(bookingId) {
        const [booking] = await this.database.db
            .select()
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId), (0, drizzle_orm_1.eq)(schema_1.bookings.status, "PENDING_HOST_APPROVAL"), (0, drizzle_orm_1.gt)(schema_1.bookings.hostResponseDeadlineAt, new Date())))
            .limit(1);
        if (!booking)
            return { sent: false };
        await this.notifications.enqueue(bookingId, "BOOKING_REQUEST_REMINDER");
        return { sent: true };
    }
    async sweep() {
        const due = await this.database.db
            .select({ id: schema_1.bookings.id })
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.status, "PENDING_HOST_APPROVAL"), (0, drizzle_orm_1.lt)(schema_1.bookings.hostResponseDeadlineAt, new Date())));
        let expired = 0;
        for (const booking of due) {
            const result = await this.bookingsService.expireBookingRequest(booking.id);
            if (result.expired)
                expired += 1;
        }
        return { expired };
    }
    async scheduleSweep() {
        const minutes = Number(this.config.get("BOOKING_REQUEST_SWEEP_MINUTES") ?? 5);
        await this.queue.upsertJobScheduler("booking-request-sweep", { every: minutes * 60 * 1000 }, { name: SWEEP_JOB, data: { bookingId: "" } });
    }
    async onApplicationShutdown() {
        await this.worker?.close();
        this.worker = null;
    }
};
exports.BookingLifecycleWorker = BookingLifecycleWorker;
exports.BookingLifecycleWorker = BookingLifecycleWorker = BookingLifecycleWorker_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(queue_module_1.REDIS_CONNECTION)),
    __param(1, (0, common_1.Inject)(queue_module_1.LIFECYCLE_QUEUE)),
    __param(2, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Function, Function, Object, bookings_service_1.BookingsService,
        notification_worker_1.NotificationWorker,
        config_1.ConfigService])
], BookingLifecycleWorker);
//# sourceMappingURL=booking-lifecycle.worker.js.map