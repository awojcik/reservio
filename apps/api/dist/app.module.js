"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nestjs_pino_1 = require("nestjs-pino");
const database_module_1 = require("./infrastructure/database/database.module");
const outbox_module_1 = require("./infrastructure/outbox/outbox.module");
const queue_module_1 = require("./infrastructure/queue/queue.module");
const account_module_1 = require("./modules/account/account.module");
const amenities_module_1 = require("./modules/amenities/amenities.module");
const auth_module_1 = require("./modules/auth/auth.module");
const availability_module_1 = require("./modules/availability/availability.module");
const bookings_module_1 = require("./modules/bookings/bookings.module");
const calendars_module_1 = require("./modules/calendars/calendars.module");
const notifications_module_1 = require("./modules/notifications/notifications.module");
const health_module_1 = require("./modules/health/health.module");
const storage_module_1 = require("./modules/storage/storage.module");
const properties_module_1 = require("./modules/properties/properties.module");
const search_module_1 = require("./modules/search/search.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env", "../../.env"],
            }),
            nestjs_pino_1.LoggerModule.forRoot({
                pinoHttp: {
                    level: process.env.LOG_LEVEL ?? "info",
                    transport: process.env.NODE_ENV === "production"
                        ? undefined
                        : { target: "pino-pretty", options: { singleLine: true } },
                    redact: [
                        "req.headers.authorization",
                        "req.headers.cookie",
                        "res.headers['set-cookie']",
                    ],
                    serializers: {
                        req(request) {
                            if (typeof request.url === "string") {
                                request.url = request.url.replace(/\/calendar\/ical\/[^/?]+/, "/calendar/ical/[redacted].ics");
                            }
                            return request;
                        },
                    },
                },
            }),
            database_module_1.DatabaseModule,
            queue_module_1.QueueModule,
            outbox_module_1.OutboxModule,
            storage_module_1.StorageModule,
            auth_module_1.AuthModule,
            account_module_1.AccountModule,
            amenities_module_1.AmenitiesModule,
            availability_module_1.AvailabilityModule,
            bookings_module_1.BookingsModule,
            calendars_module_1.CalendarsModule,
            notifications_module_1.NotificationsModule,
            health_module_1.HealthModule,
            properties_module_1.PropertiesModule,
            search_module_1.SearchModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map