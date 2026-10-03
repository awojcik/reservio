"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsModule = void 0;
const common_1 = require("@nestjs/common");
const outbox_module_1 = require("../../infrastructure/outbox/outbox.module");
const guest_access_module_1 = require("../bookings/guest-access.module");
const notification_worker_1 = require("./application/notification.worker");
const notifications_service_1 = require("./application/notifications.service");
const email_provider_1 = require("./infrastructure/email-provider");
const smtp_email_provider_1 = require("./infrastructure/smtp-email-provider");
let NotificationsModule = class NotificationsModule {
};
exports.NotificationsModule = NotificationsModule;
exports.NotificationsModule = NotificationsModule = __decorate([
    (0, common_1.Module)({
        imports: [guest_access_module_1.GuestAccessModule, outbox_module_1.OutboxModule],
        providers: [
            notifications_service_1.NotificationsService,
            notification_worker_1.NotificationWorker,
            smtp_email_provider_1.SmtpEmailProvider,
            { provide: email_provider_1.EMAIL_PROVIDER, useExisting: smtp_email_provider_1.SmtpEmailProvider },
        ],
        exports: [notifications_service_1.NotificationsService, notification_worker_1.NotificationWorker],
    })
], NotificationsModule);
//# sourceMappingURL=notifications.module.js.map