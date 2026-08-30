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
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../../infrastructure/database/database.module");
const schema_1 = require("../../../infrastructure/database/schema");
const notification_1 = require("../domain/notification");
const email_provider_1 = require("../infrastructure/email-provider");
const booking_emails_1 = require("../templates/booking-emails");
const guest_access_service_1 = require("../../bookings/guest-access.service");
const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(error) {
    const codes = [
        error.code,
        (error.cause ?? {}).code,
    ];
    return codes.includes(UNIQUE_VIOLATION);
}
let NotificationsService = NotificationsService_1 = class NotificationsService {
    database;
    email;
    guestAccess;
    config;
    logger = new common_1.Logger(NotificationsService_1.name);
    constructor(database, email, guestAccess, config) {
        this.database = database;
        this.email = email;
        this.guestAccess = guestAccess;
        this.config = config;
    }
    get appBaseUrl() {
        return (this.config.get("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
    }
    async deliver(bookingId, type) {
        const dedupKey = (0, notification_1.dedupKeyFor)(type, bookingId);
        const context = await this.loadContext(bookingId, type);
        if (!context) {
            this.logger.warn({ event: "notification.skipped", bookingId, type, reason: "NO_CONTEXT" });
            return "FAILED";
        }
        const claim = await this.claim(bookingId, type, context.recipient, dedupKey);
        if (claim === "ALREADY_SENT") {
            this.logger.log({ event: "notification.deduped", bookingId, type });
            return "ALREADY_SENT";
        }
        const message = (0, booking_emails_1.renderBookingEmail)(type, context.email);
        message.to = context.recipient;
        try {
            await this.email.send(message);
        }
        catch (error) {
            const permanent = error instanceof notification_1.PermanentEmailError;
            await this.database.db
                .update(schema_1.notificationDeliveries)
                .set({
                status: permanent ? "FAILED" : "PENDING",
                lastErrorCode: error.code ?? "UNKNOWN",
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.notificationDeliveries.dedupKey, dedupKey));
            this.logger.warn({
                event: "notification.failed",
                bookingId,
                type,
                errorCode: error.code ?? "UNKNOWN",
                permanent,
            });
            if (permanent)
                return "FAILED";
            throw error;
        }
        await this.database.db
            .update(schema_1.notificationDeliveries)
            .set({ status: "SENT", sentAt: new Date(), lastErrorCode: null, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.notificationDeliveries.dedupKey, dedupKey));
        this.logger.log({ event: "notification.sent", bookingId, type });
        return "SENT";
    }
    async claim(bookingId, type, recipient, dedupKey) {
        try {
            await this.database.db.insert(schema_1.notificationDeliveries).values({
                bookingId,
                type,
                recipientType: notification_1.NOTIFICATION_RECIPIENTS[type],
                recipientAddress: recipient,
                status: "PENDING",
                dedupKey,
                attemptCount: 1,
            });
            return "CLAIMED";
        }
        catch (error) {
            if (!isUniqueViolation(error))
                throw error;
            const [existing] = await this.database.db
                .select()
                .from(schema_1.notificationDeliveries)
                .where((0, drizzle_orm_1.eq)(schema_1.notificationDeliveries.dedupKey, dedupKey))
                .limit(1);
            if (existing?.status === "SENT" || existing?.status === "FAILED") {
                return "ALREADY_SENT";
            }
            await this.database.db
                .update(schema_1.notificationDeliveries)
                .set({ attemptCount: (existing?.attemptCount ?? 0) + 1, updatedAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.notificationDeliveries.dedupKey, dedupKey));
            return "CLAIMED";
        }
    }
    async loadContext(bookingId, type) {
        const [row] = await this.database.db
            .select({ booking: schema_1.bookings, hostEmail: schema_1.users.email })
            .from(schema_1.bookings)
            .innerJoin(schema_1.hosts, (0, drizzle_orm_1.eq)(schema_1.hosts.id, schema_1.bookings.hostId))
            .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.hosts.userId))
            .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId))
            .limit(1);
        if (!row)
            return null;
        const goesToHost = notification_1.NOTIFICATION_RECIPIENTS[type] === "HOST";
        const recipient = goesToHost ? row.hostEmail : row.booking.guestEmail;
        if (!recipient)
            return null;
        const booking = row.booking;
        const guestUrl = goesToHost
            ? undefined
            : await this.guestAccess.buildAccessUrl(booking.id, booking.publicReference, this.appBaseUrl);
        return {
            recipient,
            email: {
                reference: booking.publicReference,
                propertyTitle: booking.propertyTitleSnapshot,
                checkIn: booking.checkIn,
                checkOut: booking.checkOut,
                adults: booking.adults,
                children: booking.children,
                totalAmountMinor: booking.totalAmountMinor,
                currency: booking.currency,
                guestName: booking.guestName,
                guestUrl,
                hostUrl: goesToHost ? `${this.appBaseUrl}/host/bookings/${booking.id}` : undefined,
                hostResponseDeadlineAt: booking.hostResponseDeadlineAt?.toISOString() ?? null,
            },
        };
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(email_provider_1.EMAIL_PROVIDER)),
    __metadata("design:paramtypes", [Object, Object, guest_access_service_1.GuestAccessService,
        config_1.ConfigService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map