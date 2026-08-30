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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueModule = exports.NOTIFICATIONS_QUEUE = exports.LIFECYCLE_QUEUE = exports.HOLD_QUEUE = exports.SYNC_QUEUE = exports.REDIS_CONNECTION = exports.NOTIFICATION_QUEUE = exports.BOOKING_LIFECYCLE_QUEUE = exports.BOOKING_HOLD_QUEUE = exports.CALENDAR_SYNC_QUEUE = void 0;
exports.queuePrefix = queuePrefix;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
exports.CALENDAR_SYNC_QUEUE = "calendar-sync";
exports.BOOKING_HOLD_QUEUE = "booking-hold-expire";
exports.BOOKING_LIFECYCLE_QUEUE = "booking-lifecycle";
exports.NOTIFICATION_QUEUE = "notifications";
function queuePrefix(config) {
    return config.get("BULLMQ_PREFIX") ?? "rezervio";
}
exports.REDIS_CONNECTION = Symbol("REDIS_CONNECTION");
exports.SYNC_QUEUE = Symbol("SYNC_QUEUE");
exports.HOLD_QUEUE = Symbol("HOLD_QUEUE");
exports.LIFECYCLE_QUEUE = Symbol("LIFECYCLE_QUEUE");
exports.NOTIFICATIONS_QUEUE = Symbol("NOTIFICATIONS_QUEUE");
let QueueLifecycle = class QueueLifecycle {
    redis;
    syncQueue;
    holdQueue;
    lifecycleQueue;
    notificationQueue;
    constructor(redis, syncQueue, holdQueue, lifecycleQueue, notificationQueue) {
        this.redis = redis;
        this.syncQueue = syncQueue;
        this.holdQueue = holdQueue;
        this.lifecycleQueue = lifecycleQueue;
        this.notificationQueue = notificationQueue;
    }
    async onApplicationShutdown() {
        await this.syncQueue.close();
        await this.holdQueue.close();
        await this.lifecycleQueue.close();
        await this.notificationQueue.close();
        this.redis.disconnect();
    }
};
QueueLifecycle = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(exports.REDIS_CONNECTION)),
    __param(1, (0, common_1.Inject)(exports.SYNC_QUEUE)),
    __param(2, (0, common_1.Inject)(exports.HOLD_QUEUE)),
    __param(3, (0, common_1.Inject)(exports.LIFECYCLE_QUEUE)),
    __param(4, (0, common_1.Inject)(exports.NOTIFICATIONS_QUEUE)),
    __metadata("design:paramtypes", [Function, bullmq_1.Queue,
        bullmq_1.Queue,
        bullmq_1.Queue,
        bullmq_1.Queue])
], QueueLifecycle);
let QueueModule = class QueueModule {
};
exports.QueueModule = QueueModule;
exports.QueueModule = QueueModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: exports.REDIS_CONNECTION,
                inject: [config_1.ConfigService],
                useFactory: (config) => new ioredis_1.default(config.get("REDIS_URL") ?? "redis://localhost:6379", {
                    maxRetriesPerRequest: null,
                }),
            },
            {
                provide: exports.SYNC_QUEUE,
                inject: [exports.REDIS_CONNECTION, config_1.ConfigService],
                useFactory: (connection, config) => new bullmq_1.Queue(exports.CALENDAR_SYNC_QUEUE, {
                    connection,
                    prefix: queuePrefix(config),
                    defaultJobOptions: {
                        attempts: 5,
                        backoff: { type: "exponential", delay: 30_000 },
                        removeOnComplete: { count: 100 },
                        removeOnFail: { count: 500 },
                    },
                }),
            },
            {
                provide: exports.HOLD_QUEUE,
                inject: [exports.REDIS_CONNECTION, config_1.ConfigService],
                useFactory: (connection, config) => new bullmq_1.Queue(exports.BOOKING_HOLD_QUEUE, {
                    connection,
                    prefix: queuePrefix(config),
                    defaultJobOptions: {
                        attempts: 3,
                        backoff: { type: "exponential", delay: 10_000 },
                        removeOnComplete: { count: 100 },
                        removeOnFail: { count: 500 },
                    },
                }),
            },
            {
                provide: exports.LIFECYCLE_QUEUE,
                inject: [exports.REDIS_CONNECTION, config_1.ConfigService],
                useFactory: (connection, config) => new bullmq_1.Queue(exports.BOOKING_LIFECYCLE_QUEUE, {
                    connection,
                    prefix: queuePrefix(config),
                    defaultJobOptions: {
                        attempts: 3,
                        backoff: { type: "exponential", delay: 30_000 },
                        removeOnComplete: { count: 100 },
                        removeOnFail: { count: 500 },
                    },
                }),
            },
            {
                provide: exports.NOTIFICATIONS_QUEUE,
                inject: [exports.REDIS_CONNECTION, config_1.ConfigService],
                useFactory: (connection, config) => new bullmq_1.Queue(exports.NOTIFICATION_QUEUE, {
                    connection,
                    prefix: queuePrefix(config),
                    defaultJobOptions: {
                        attempts: 5,
                        backoff: { type: "exponential", delay: 15_000 },
                        removeOnComplete: { count: 200 },
                        removeOnFail: { count: 500 },
                    },
                }),
            },
            QueueLifecycle,
        ],
        exports: [
            exports.REDIS_CONNECTION,
            exports.SYNC_QUEUE,
            exports.HOLD_QUEUE,
            exports.LIFECYCLE_QUEUE,
            exports.NOTIFICATIONS_QUEUE,
        ],
    })
], QueueModule);
//# sourceMappingURL=queue.module.js.map