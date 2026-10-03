"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsModule = void 0;
const common_1 = require("@nestjs/common");
const account_module_1 = require("../account/account.module");
const auth_module_1 = require("../auth/auth.module");
const availability_core_module_1 = require("../availability/availability-core.module");
const hosts_module_1 = require("../hosts/hosts.module");
const notifications_module_1 = require("../notifications/notifications.module");
const payment_cancel_scheduler_1 = require("../payments/payment-cancel.scheduler");
const payment_read_service_1 = require("../payments/payment-read.service");
const stay_schedule_canceller_1 = require("../stay/stay-schedule.canceller");
const booking_hold_worker_1 = require("./booking-hold.worker");
const booking_lifecycle_worker_1 = require("./booking-lifecycle.worker");
const bookings_controller_1 = require("./bookings.controller");
const bookings_service_1 = require("./bookings.service");
const guest_access_module_1 = require("./guest-access.module");
const host_bookings_controller_1 = require("./host-bookings.controller");
const idempotency_service_1 = require("./idempotency.service");
let BookingsModule = class BookingsModule {
};
exports.BookingsModule = BookingsModule;
exports.BookingsModule = BookingsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            auth_module_1.AuthModule,
            availability_core_module_1.AvailabilityCoreModule,
            guest_access_module_1.GuestAccessModule,
            notifications_module_1.NotificationsModule,
            hosts_module_1.HostsModule,
            account_module_1.AccountModule,
            payment_cancel_scheduler_1.PaymentCancelModule,
            payment_read_service_1.PaymentReadModule,
            stay_schedule_canceller_1.StayScheduleModule,
        ],
        controllers: [bookings_controller_1.BookingsController, host_bookings_controller_1.HostBookingsController],
        providers: [
            bookings_service_1.BookingsService,
            idempotency_service_1.IdempotencyService,
            booking_hold_worker_1.BookingHoldWorker,
            booking_lifecycle_worker_1.BookingLifecycleWorker,
        ],
        exports: [bookings_service_1.BookingsService, booking_hold_worker_1.BookingHoldWorker, booking_lifecycle_worker_1.BookingLifecycleWorker],
    })
], BookingsModule);
//# sourceMappingURL=bookings.module.js.map