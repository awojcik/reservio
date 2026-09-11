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
var NotificationWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationWorker = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const queue_module_1 = require("../../../infrastructure/queue/queue.module");
const outbox_service_1 = require("../../../infrastructure/outbox/outbox.service");
const notification_1 = require("../domain/notification");
const notifications_service_1 = require("./notifications.service");
const OUTBOX_JOB = "outbox";
const SEND_JOB = "send";
function jobIdFor(type, bookingId, refId) {
    const slug = type.toLowerCase().replace(/_/g, "-");
    return `notify-${slug}-${refId ?? bookingId}`;
}
let NotificationWorker = NotificationWorker_1 = class NotificationWorker {
    connection;
    queue;
    notifications;
    outbox;
    config;
    logger = new common_1.Logger(NotificationWorker_1.name);
    worker = null;
    constructor(connection, queue, notifications, outbox, config) {
        this.connection = connection;
        this.queue = queue;
        this.notifications = notifications;
        this.outbox = outbox;
        this.config = config;
    }
    async onModuleInit() {
        if (this.config.get("DISABLE_NOTIFICATION_WORKER") === "true")
            return;
        this.start();
        await this.scheduleOutboxPump();
    }
    start() {
        if (this.worker?.isRunning())
            return this.worker;
        this.worker = new bullmq_1.Worker(queue_module_1.NOTIFICATION_QUEUE, async (job) => {
            if (job.name === OUTBOX_JOB)
                return this.pumpOutbox();
            try {
                return await this.notifications.deliver(job.data.bookingId, job.data.type, job.data.refId ?? null);
            }
            catch (error) {
                if (error instanceof notification_1.PermanentEmailError) {
                    throw new bullmq_1.UnrecoverableError(`${error.code}: ${error.message}`);
                }
                throw error;
            }
        }, { connection: this.connection, concurrency: 4, prefix: (0, queue_module_1.queuePrefix)(this.config) });
        this.worker.on("failed", (job, error) => {
            this.logger.warn({
                event: "notification.job_failed",
                jobId: job?.id,
                attempts: job?.attemptsMade,
                reason: error.message,
            });
        });
        return this.worker;
    }
    async scheduleOutboxPump() {
        const seconds = Number(this.config.get("OUTBOX_POLL_SECONDS") ?? 5);
        await this.queue.upsertJobScheduler("outbox-pump", { every: seconds * 1000 }, { name: OUTBOX_JOB, data: { bookingId: "", type: "" } });
    }
    async pumpOutbox() {
        await this.outbox.recoverStale();
        const claimed = await this.outbox.claimPending(50, ["NOTIFICATION"]);
        let enqueued = 0;
        for (const event of claimed) {
            const type = event.payload.notificationType;
            if (!type) {
                await this.outbox.markProcessed(event.id);
                continue;
            }
            try {
                await this.enqueue(event.payload.bookingId, type, event.payload.refId ?? null);
                await this.outbox.markProcessed(event.id);
                enqueued += 1;
            }
            catch (error) {
                await this.outbox.markFailed(event.id, error.message);
            }
        }
        return { enqueued };
    }
    async enqueue(bookingId, type, refId = null) {
        await this.queue.add(SEND_JOB, { bookingId, type, refId: refId ?? undefined }, { jobId: jobIdFor(type, bookingId, refId) });
        this.logger.log({ event: "notification.enqueued", bookingId, type });
    }
    async requeue(bookingId, type, refId = null) {
        await this.queue.remove(jobIdFor(type, bookingId, refId)).catch(() => undefined);
        await this.enqueue(bookingId, type, refId);
    }
    async onApplicationShutdown() {
        await this.worker?.close();
        this.worker = null;
    }
};
exports.NotificationWorker = NotificationWorker;
exports.NotificationWorker = NotificationWorker = NotificationWorker_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(queue_module_1.REDIS_CONNECTION)),
    __param(1, (0, common_1.Inject)(queue_module_1.NOTIFICATIONS_QUEUE)),
    __metadata("design:paramtypes", [Function, Function, notifications_service_1.NotificationsService,
        outbox_service_1.OutboxService,
        config_1.ConfigService])
], NotificationWorker);
//# sourceMappingURL=notification.worker.js.map