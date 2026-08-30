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
var BookingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsService = exports.CannotBookOwnPropertyError = exports.PropertyNotAvailableError = exports.BookingRequestExpiredError = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const outbox_service_1 = require("../../infrastructure/outbox/outbox.service");
const guest_access_service_1 = require("./guest-access.service");
const pricing_1 = require("../../domain/pricing");
const booking_1 = require("../../domain/booking");
const availability_1 = require("../../domain/availability");
const availability_service_1 = require("../availability/availability.service");
const object_storage_1 = require("../storage/object-storage");
class BookingRequestExpiredError extends common_1.ConflictException {
    constructor() {
        super({
            code: "BOOKING_REQUEST_EXPIRED",
            message: "Czas na odpowiedź minął — prośba wygasła.",
        });
    }
}
exports.BookingRequestExpiredError = BookingRequestExpiredError;
class PropertyNotAvailableError extends common_1.ConflictException {
    constructor() {
        super({
            code: "PROPERTY_NOT_AVAILABLE",
            message: "Ten termin nie jest już dostępny.",
        });
    }
}
exports.PropertyNotAvailableError = PropertyNotAvailableError;
class CannotBookOwnPropertyError extends common_1.ConflictException {
    constructor() {
        super({
            code: "CANNOT_BOOK_OWN_PROPERTY",
            message: "Nie możesz zarezerwować własnego obiektu.",
        });
    }
}
exports.CannotBookOwnPropertyError = CannotBookOwnPropertyError;
let BookingsService = BookingsService_1 = class BookingsService {
    database;
    availability;
    storage;
    outbox;
    guestAccess;
    config;
    logger = new common_1.Logger(BookingsService_1.name);
    constructor(database, availability, storage, outbox, guestAccess, config) {
        this.database = database;
        this.availability = availability;
        this.storage = storage;
        this.outbox = outbox;
        this.guestAccess = guestAccess;
        this.config = config;
    }
    get holdTtlSeconds() {
        return Number(this.config.get("BOOKING_HOLD_TTL_SECONDS") ?? 600);
    }
    get requestTtlSeconds() {
        return Number(this.config.get("BOOKING_REQUEST_TTL_SECONDS") ?? 86_400);
    }
    async recordEvent(tx, bookingId, type, actorType, actorId, metadata) {
        await tx.insert(schema_1.bookingEvents).values({
            bookingId,
            type,
            actorType,
            actorId: actorId ?? null,
            metadataJson: metadata ? JSON.stringify(metadata) : null,
        });
    }
    async notify(tx, bookingId, type) {
        await this.outbox.record(tx, {
            type: "NOTIFICATION",
            aggregateType: "booking",
            aggregateId: bookingId,
            payload: { bookingId, notificationType: type },
        });
    }
    async createBooking(input) {
        const stay = { startDate: input.checkIn, endDate: input.checkOut };
        (0, availability_1.assertValidRange)(stay);
        return this.database.db.transaction(async (tx) => {
            await (0, availability_service_1.acquirePropertyLock)(tx, input.propertyId);
            const [property] = await tx
                .select()
                .from(schema_1.properties)
                .where((0, drizzle_orm_1.eq)(schema_1.properties.id, input.propertyId))
                .limit(1);
            if (!property || property.status !== "PUBLISHED") {
                throw new common_1.NotFoundException("Nie znaleziono obiektu.");
            }
            if (input.actingHostId && input.actingHostId === property.hostId) {
                throw new CannotBookOwnPropertyError();
            }
            (0, booking_1.assertCapacity)({ adults: input.adults, children: input.children }, property.maxGuests);
            const free = await this.availability.isAvailableWithin(tx, property.id, stay);
            if (!free) {
                this.logger.warn({
                    event: "booking.availability_conflict",
                    propertyId: property.id,
                    checkIn: input.checkIn,
                    checkOut: input.checkOut,
                });
                throw new PropertyNotAvailableError();
            }
            const amounts = (0, booking_1.toBookingAmounts)((0, pricing_1.calculatePriceQuote)({
                baseDailyRateAmountMinor: property.baseDailyRateAmountMinor,
                cleaningFeeAmountMinor: property.cleaningFeeAmountMinor,
                marketDailyRateAmountMinor: property.marketDailyRateAmountMinor,
                currency: property.currency,
            }, input.checkIn, input.checkOut));
            const instant = property.bookingMode === "INSTANT_BOOK";
            const hostResponseDeadlineAt = instant
                ? null
                : new Date(Date.now() + this.requestTtlSeconds * 1000);
            const [booking] = await tx
                .insert(schema_1.bookings)
                .values({
                hostResponseDeadlineAt,
                publicReference: (0, booking_1.generateBookingReference)(),
                propertyId: property.id,
                hostId: property.hostId,
                bookingMode: property.bookingMode,
                status: instant ? "PENDING_PAYMENT" : "PENDING_HOST_APPROVAL",
                checkIn: input.checkIn,
                checkOut: input.checkOut,
                adults: input.adults,
                children: input.children,
                guestUserId: input.guestUserId ?? null,
                guestName: input.guest.name,
                guestEmail: input.guest.email,
                guestPhone: input.guest.phone ?? null,
                propertyTitleSnapshot: property.title,
                propertyCitySnapshot: property.city || null,
                coverImageUrlSnapshot: await this.coverImageUrl(tx, property.id),
                ...amounts,
            })
                .returning();
            this.logger.log({
                event: instant ? "booking.created" : "booking.requested",
                bookingId: booking.id,
                reference: booking.publicReference,
                propertyId: property.id,
                mode: property.bookingMode,
                totalAmountMinor: amounts.totalAmountMinor,
                currency: amounts.currency,
            });
            await this.recordEvent(tx, booking.id, "BOOKING_CREATED", "GUEST", null, {
                mode: property.bookingMode,
            });
            const guestAccessToken = await this.guestAccess.issue(booking.id, tx);
            if (!instant) {
                await this.notify(tx, booking.id, "BOOKING_REQUEST_CREATED");
                return { booking, holdExpiresAt: null, guestAccessToken };
            }
            const hold = await this.createHold(tx, booking.id, property.id, stay);
            return { booking, holdExpiresAt: hold.expiresAt, guestAccessToken };
        });
    }
    async acceptBookingRequest(hostId, bookingId) {
        const outcome = await this.database.db.transaction(async (tx) => {
            const booking = await this.loadOwned(tx, hostId, bookingId, true);
            if (booking.status === "PENDING_PAYMENT") {
                const [existing] = await tx
                    .select()
                    .from(schema_1.bookingHolds)
                    .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.bookingId, booking.id))
                    .limit(1);
                return { conflict: false, booking, holdExpiresAt: existing?.expiresAt ?? null };
            }
            if (booking.status !== "PENDING_HOST_APPROVAL") {
                throw new common_1.ConflictException("Ta prośba została już rozpatrzona.");
            }
            if (booking.hostResponseDeadlineAt &&
                booking.hostResponseDeadlineAt.getTime() <= Date.now()) {
                return { conflict: true, bookingId: booking.id, reason: "DEADLINE" };
            }
            await (0, availability_service_1.acquirePropertyLock)(tx, booking.propertyId);
            const stay = { startDate: booking.checkIn, endDate: booking.checkOut };
            const free = await this.availability.isAvailableWithin(tx, booking.propertyId, stay);
            if (!free)
                return { conflict: true, bookingId: booking.id, reason: "AVAILABILITY" };
            const hold = await this.createHold(tx, booking.id, booking.propertyId, stay);
            const [updated] = await tx
                .update(schema_1.bookings)
                .set({
                status: "PENDING_PAYMENT",
                hostRespondedAt: new Date(),
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, booking.id))
                .returning();
            await this.recordEvent(tx, booking.id, "HOST_ACCEPTED", "HOST", hostId);
            await this.recordEvent(tx, booking.id, "HOLD_CREATED", "SYSTEM", null, {
                expiresAt: hold.expiresAt.toISOString(),
            });
            await this.notify(tx, booking.id, "BOOKING_REQUEST_ACCEPTED");
            this.logger.log({
                event: "booking.request.accepted",
                bookingId: booking.id,
                propertyId: booking.propertyId,
                hostId,
            });
            return { conflict: false, booking: updated, holdExpiresAt: hold.expiresAt };
        });
        if (!outcome.conflict) {
            return { booking: outcome.booking, holdExpiresAt: outcome.holdExpiresAt };
        }
        const reason = outcome.reason === "DEADLINE" ? "HOST_RESPONSE_TIMEOUT" : "AVAILABILITY_LOST";
        await this.database.db.transaction(async (tx) => {
            const [expired] = await tx
                .update(schema_1.bookings)
                .set({
                status: "EXPIRED",
                statusReason: reason,
                expiredAt: new Date(),
                hostRespondedAt: new Date(),
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.id, outcome.bookingId), (0, drizzle_orm_1.eq)(schema_1.bookings.status, "PENDING_HOST_APPROVAL")))
                .returning();
            if (!expired)
                return;
            await this.recordEvent(tx, outcome.bookingId, "REQUEST_EXPIRED", "SYSTEM", null, {
                reason,
            });
            await this.notify(tx, outcome.bookingId, "BOOKING_REQUEST_EXPIRED");
        });
        this.logger.warn({
            event: outcome.reason === "DEADLINE"
                ? "booking.request.expired"
                : "booking.availability_conflict",
            bookingId: outcome.bookingId,
            hostId,
            stage: "accept",
        });
        if (outcome.reason === "DEADLINE")
            throw new BookingRequestExpiredError();
        throw new PropertyNotAvailableError();
    }
    async rejectBookingRequest(hostId, bookingId) {
        return this.database.db.transaction(async (tx) => {
            const booking = await this.loadOwned(tx, hostId, bookingId, true);
            if (booking.status === "CANCELLED")
                return booking;
            if (booking.status !== "PENDING_HOST_APPROVAL") {
                throw new common_1.ConflictException("Ta prośba została już rozpatrzona.");
            }
            const [updated] = await tx
                .update(schema_1.bookings)
                .set({
                status: "CANCELLED",
                statusReason: "HOST_REJECTED",
                cancelledAt: new Date(),
                hostRespondedAt: new Date(),
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, booking.id))
                .returning();
            await this.recordEvent(tx, booking.id, "HOST_REJECTED", "HOST", hostId);
            await this.notify(tx, booking.id, "BOOKING_REQUEST_REJECTED");
            this.logger.log({
                event: "booking.request.rejected",
                bookingId: booking.id,
                propertyId: booking.propertyId,
                hostId,
            });
            return updated;
        });
    }
    async expireBookingHold(holdId) {
        return this.database.db.transaction(async (tx) => {
            const [hold] = await tx
                .select()
                .from(schema_1.bookingHolds)
                .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.id, holdId))
                .limit(1);
            if (!hold || hold.status !== "ACTIVE")
                return { expired: false };
            if (hold.expiresAt.getTime() > Date.now())
                return { expired: false };
            await (0, availability_service_1.acquirePropertyLock)(tx, hold.propertyId);
            await tx
                .update(schema_1.bookingHolds)
                .set({ status: "EXPIRED", expiredAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.id, hold.id));
            await tx.execute((0, drizzle_orm_1.sql) `DELETE FROM availability_blocks WHERE booking_hold_id = ${hold.id}`);
            await tx
                .update(schema_1.bookings)
                .set({
                status: "EXPIRED",
                statusReason: "HOLD_EXPIRED",
                expiredAt: new Date(),
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.id, hold.bookingId), (0, drizzle_orm_1.eq)(schema_1.bookings.status, "PENDING_PAYMENT")));
            await this.recordEvent(tx, hold.bookingId, "HOLD_EXPIRED", "SYSTEM");
            this.logger.log({
                event: "booking.hold.expired",
                holdId: hold.id,
                bookingId: hold.bookingId,
                propertyId: hold.propertyId,
            });
            return { expired: true };
        });
    }
    async expireBookingRequest(bookingId) {
        return this.database.db.transaction(async (tx) => {
            const [booking] = await tx
                .select()
                .from(schema_1.bookings)
                .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId))
                .limit(1)
                .for("update");
            if (!booking || booking.status !== "PENDING_HOST_APPROVAL")
                return { expired: false };
            if (booking.hostResponseDeadlineAt &&
                booking.hostResponseDeadlineAt.getTime() > Date.now()) {
                return { expired: false };
            }
            await tx
                .update(schema_1.bookings)
                .set({
                status: "EXPIRED",
                statusReason: "HOST_RESPONSE_TIMEOUT",
                expiredAt: new Date(),
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, booking.id));
            await this.recordEvent(tx, booking.id, "REQUEST_EXPIRED", "SYSTEM");
            await this.notify(tx, booking.id, "BOOKING_REQUEST_EXPIRED");
            this.logger.log({
                event: "booking.request.expired",
                bookingId: booking.id,
                propertyId: booking.propertyId,
            });
            return { expired: true };
        });
    }
    async cancelBookingByGuest(bookingId) {
        return this.cancelBooking(bookingId, "GUEST", null, "GUEST_CANCELLED");
    }
    async cancelBookingByHost(hostId, bookingId) {
        await this.loadOwned(this.database.db, hostId, bookingId, false);
        return this.cancelBooking(bookingId, "HOST", hostId, "HOST_CANCELLED");
    }
    async cancelBooking(bookingId, actor, actorId, reason) {
        return this.database.db.transaction(async (tx) => {
            const [booking] = await tx
                .select()
                .from(schema_1.bookings)
                .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId))
                .limit(1)
                .for("update");
            if (!booking)
                throw new common_1.NotFoundException("Nie znaleziono rezerwacji.");
            if (booking.status === "CANCELLED")
                return booking;
            if (booking.status !== "PENDING_HOST_APPROVAL" &&
                booking.status !== "PENDING_PAYMENT") {
                throw new common_1.ConflictException({
                    code: "BOOKING_NOT_CANCELLABLE",
                    message: "Tej rezerwacji nie można już anulować.",
                });
            }
            if (booking.status === "PENDING_PAYMENT") {
                await (0, availability_service_1.acquirePropertyLock)(tx, booking.propertyId);
                const [hold] = await tx
                    .select()
                    .from(schema_1.bookingHolds)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingHolds.bookingId, booking.id), (0, drizzle_orm_1.eq)(schema_1.bookingHolds.status, "ACTIVE")))
                    .limit(1);
                if (hold) {
                    await tx
                        .update(schema_1.bookingHolds)
                        .set({ status: "RELEASED", releasedAt: new Date() })
                        .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.id, hold.id));
                    await tx.execute((0, drizzle_orm_1.sql) `DELETE FROM availability_blocks WHERE booking_hold_id = ${hold.id}`);
                    await this.recordEvent(tx, booking.id, "HOLD_RELEASED", "SYSTEM");
                }
            }
            const [updated] = await tx
                .update(schema_1.bookings)
                .set({
                status: "CANCELLED",
                statusReason: reason,
                cancelledAt: new Date(),
                updatedAt: new Date(),
                ...(actor === "HOST" ? { hostRespondedAt: new Date() } : {}),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, booking.id))
                .returning();
            await this.recordEvent(tx, booking.id, actor === "GUEST" ? "GUEST_CANCELLED" : "HOST_CANCELLED", actor, actorId);
            await this.notify(tx, booking.id, actor === "GUEST" ? "BOOKING_CANCELLED_BY_GUEST" : "BOOKING_CANCELLED_BY_HOST");
            this.logger.log({
                event: actor === "GUEST" ? "booking.cancelled.guest" : "booking.cancelled.host",
                bookingId: booking.id,
                propertyId: booking.propertyId,
            });
            return updated;
        });
    }
    async coverImageUrl(tx, propertyId) {
        const rows = (await tx.execute((0, drizzle_orm_1.sql) `
      SELECT object_key, url FROM property_images
      WHERE property_id = ${propertyId}
      ORDER BY position ASC
      LIMIT 1
    `));
        const cover = rows[0];
        if (!cover)
            return null;
        return cover.object_key ? this.storage.getPublicUrl(cover.object_key) : cover.url;
    }
    async timelineFor(bookingId) {
        return this.database.db
            .select()
            .from(schema_1.bookingEvents)
            .where((0, drizzle_orm_1.eq)(schema_1.bookingEvents.bookingId, bookingId))
            .orderBy(schema_1.bookingEvents.createdAt);
    }
    async findExpiredRequests() {
        return this.database.db
            .select({ id: schema_1.bookings.id })
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.status, "PENDING_HOST_APPROVAL"), (0, drizzle_orm_1.lt)(schema_1.bookings.hostResponseDeadlineAt, new Date())));
    }
    async releaseBookingHold(holdId) {
        await this.database.db.transaction(async (tx) => {
            const [hold] = await tx
                .select()
                .from(schema_1.bookingHolds)
                .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.id, holdId))
                .limit(1);
            if (!hold || hold.status !== "ACTIVE")
                return;
            await (0, availability_service_1.acquirePropertyLock)(tx, hold.propertyId);
            await tx
                .update(schema_1.bookingHolds)
                .set({ status: "RELEASED", releasedAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.bookingHolds.id, hold.id));
            await tx.execute((0, drizzle_orm_1.sql) `DELETE FROM availability_blocks WHERE booking_hold_id = ${hold.id}`);
            this.logger.log({
                event: "booking.hold.released",
                holdId: hold.id,
                bookingId: hold.bookingId,
            });
        });
    }
    async findByIdInternal(bookingId) {
        const [booking] = await this.database.db
            .select()
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId))
            .limit(1);
        if (!booking)
            throw new common_1.NotFoundException("Nie znaleziono rezerwacji.");
        return booking;
    }
    async findByReference(reference) {
        const [booking] = await this.database.db
            .select()
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.eq)(schema_1.bookings.publicReference, reference))
            .limit(1);
        if (!booking)
            throw new common_1.NotFoundException("Nie znaleziono rezerwacji.");
        const [hold] = await this.database.db
            .select()
            .from(schema_1.bookingHolds)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingHolds.bookingId, booking.id), (0, drizzle_orm_1.eq)(schema_1.bookingHolds.status, "ACTIVE")))
            .limit(1);
        return { booking, holdExpiresAt: hold?.expiresAt ?? null };
    }
    async listForHost(hostId, filters) {
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.bookings.hostId, hostId)];
        if (filters.status)
            conditions.push((0, drizzle_orm_1.eq)(schema_1.bookings.status, filters.status));
        if (filters.propertyId)
            conditions.push((0, drizzle_orm_1.eq)(schema_1.bookings.propertyId, filters.propertyId));
        return this.database.db
            .select()
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.bookings.createdAt));
    }
    async findForHost(hostId, bookingId) {
        const booking = await this.loadOwned(this.database.db, hostId, bookingId, false);
        const [hold] = await this.database.db
            .select()
            .from(schema_1.bookingHolds)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingHolds.bookingId, booking.id), (0, drizzle_orm_1.eq)(schema_1.bookingHolds.status, "ACTIVE")))
            .limit(1);
        return { booking, holdExpiresAt: hold?.expiresAt ?? null };
    }
    async findActiveHold(bookingId) {
        const [hold] = await this.database.db
            .select()
            .from(schema_1.bookingHolds)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingHolds.bookingId, bookingId), (0, drizzle_orm_1.eq)(schema_1.bookingHolds.status, "ACTIVE")))
            .limit(1);
        return hold ?? null;
    }
    async createHold(tx, bookingId, propertyId, stay) {
        const expiresAt = new Date(Date.now() + this.holdTtlSeconds * 1000);
        const [hold] = await tx
            .insert(schema_1.bookingHolds)
            .values({
            bookingId,
            propertyId,
            dateRange: (0, drizzle_orm_1.sql) `${(0, availability_service_1.rangeLiteral)(stay)}`,
            status: "ACTIVE",
            expiresAt,
        })
            .returning();
        await tx.execute((0, drizzle_orm_1.sql) `
      INSERT INTO availability_blocks (property_id, source_type, date_range, booking_hold_id)
      VALUES (${propertyId}, 'BOOKING_HOLD', ${(0, availability_service_1.rangeLiteral)(stay)}, ${hold.id})
    `);
        this.logger.log({
            event: "booking.hold.created",
            holdId: hold.id,
            bookingId,
            propertyId,
            expiresAt: expiresAt.toISOString(),
        });
        return hold;
    }
    async loadOwned(executor, hostId, bookingId, forUpdate) {
        const query = executor
            .select()
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId), (0, drizzle_orm_1.eq)(schema_1.bookings.hostId, hostId)))
            .limit(1);
        const rows = forUpdate ? await query.for("update") : await query;
        const booking = rows[0];
        if (!booking)
            throw new common_1.NotFoundException("Nie znaleziono rezerwacji.");
        return booking;
    }
};
exports.BookingsService = BookingsService;
exports.BookingsService = BookingsService = BookingsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(2, (0, common_1.Inject)(object_storage_1.OBJECT_STORAGE)),
    __metadata("design:paramtypes", [Object, availability_service_1.AvailabilityService, Object, outbox_service_1.OutboxService,
        guest_access_service_1.GuestAccessService,
        config_1.ConfigService])
], BookingsService);
//# sourceMappingURL=bookings.service.js.map