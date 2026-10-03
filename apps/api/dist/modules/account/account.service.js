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
var AccountService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountService = exports.BookingEmailMismatchError = exports.BookingAlreadyClaimedError = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const trip_category_1 = require("../../domain/trip-category");
const availability_1 = require("../../domain/availability");
const guest_access_service_1 = require("../bookings/guest-access.service");
const users_service_1 = require("../users/users.service");
const hosts_service_1 = require("../hosts/hosts.service");
class BookingAlreadyClaimedError extends common_1.ConflictException {
    constructor() {
        super({
            code: "BOOKING_ALREADY_CLAIMED",
            message: "Ta rezerwacja jest już przypisana do innego konta.",
        });
    }
}
exports.BookingAlreadyClaimedError = BookingAlreadyClaimedError;
class BookingEmailMismatchError extends common_1.ConflictException {
    constructor() {
        super({
            code: "BOOKING_EMAIL_MISMATCH",
            message: "Rezerwacja została złożona na inny adres email niż ten, na który jesteś zalogowany.",
        });
    }
}
exports.BookingEmailMismatchError = BookingEmailMismatchError;
let AccountService = AccountService_1 = class AccountService {
    database;
    users;
    hosts;
    guestAccess;
    logger = new common_1.Logger(AccountService_1.name);
    constructor(database, users, hosts, guestAccess) {
        this.database = database;
        this.users = users;
        this.hosts = hosts;
        this.guestAccess = guestAccess;
    }
    async profile(userId) {
        const [user, host] = await Promise.all([
            this.users.findById(userId),
            this.hosts.findByUserId(userId),
        ]);
        if (!user)
            throw new common_1.NotFoundException("Nie znaleziono konta.");
        return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            preferredLocale: user.preferredLocale,
            isHost: Boolean(host),
        };
    }
    async updateProfile(userId, dto) {
        await this.users.updateProfile(userId, {
            ...(dto.firstName !== undefined ? { firstName: dto.firstName || null } : {}),
            ...(dto.lastName !== undefined ? { lastName: dto.lastName || null } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
            ...(dto.preferredLocale !== undefined
                ? { preferredLocale: dto.preferredLocale || null }
                : {}),
        });
        return this.profile(userId);
    }
    async trips(userId, options) {
        const limit = options.limit ?? 20;
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.bookings.guestUserId, userId)];
        if (options.cursor) {
            const decoded = decodeCursor(options.cursor);
            if (decoded) {
                conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.lt)(schema_1.bookings.createdAt, decoded.createdAt), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.createdAt, decoded.createdAt), (0, drizzle_orm_1.lt)(schema_1.bookings.id, decoded.id))));
            }
        }
        if (options.category) {
            const statuses = statusesFor(options.category);
            if (statuses.length > 0) {
                conditions.push((0, drizzle_orm_1.sql) `${schema_1.bookings.status} IN (${drizzle_orm_1.sql.join(statuses.map((status) => (0, drizzle_orm_1.sql) `${status}`), (0, drizzle_orm_1.sql) `, `)})`);
            }
        }
        const rows = await this.database.db
            .select({ booking: schema_1.bookings, slug: schema_1.properties.slug, status: schema_1.properties.status })
            .from(schema_1.bookings)
            .leftJoin(schema_1.properties, (0, drizzle_orm_1.eq)(schema_1.properties.id, schema_1.bookings.propertyId))
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.bookings.createdAt), (0, drizzle_orm_1.desc)(schema_1.bookings.id))
            .limit(limit + 1);
        const now = (0, availability_1.today)("Europe/Warsaw");
        let items = rows.slice(0, limit).map((row) => ({
            ...row.booking,
            propertySlug: row.status === "PUBLISHED" ? row.slug : null,
            category: (0, trip_category_1.categorise)(row.booking.status, row.booking.checkOut, now),
        }));
        if (options.category === "UPCOMING" || options.category === "PAST") {
            items = items.filter((item) => item.category === options.category);
        }
        const hasMore = rows.length > limit && items.length > 0;
        const last = items[items.length - 1];
        return {
            items,
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        };
    }
    async trip(userId, reference) {
        const [row] = await this.database.db
            .select({ booking: schema_1.bookings, slug: schema_1.properties.slug, status: schema_1.properties.status })
            .from(schema_1.bookings)
            .leftJoin(schema_1.properties, (0, drizzle_orm_1.eq)(schema_1.properties.id, schema_1.bookings.propertyId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.publicReference, reference), (0, drizzle_orm_1.eq)(schema_1.bookings.guestUserId, userId)))
            .limit(1);
        if (!row)
            throw new common_1.NotFoundException("Nie znaleziono rezerwacji.");
        return {
            ...row.booking,
            propertySlug: row.status === "PUBLISHED" ? row.slug : null,
            category: (0, trip_category_1.categorise)(row.booking.status, row.booking.checkOut, (0, availability_1.today)("Europe/Warsaw")),
        };
    }
    async claim(userId, userEmail, reference, guestToken) {
        const bookingId = await this.guestAccess.verify(reference, guestToken);
        const [booking] = await this.database.db
            .select()
            .from(schema_1.bookings)
            .where((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId))
            .limit(1);
        if (!booking)
            throw new common_1.NotFoundException("Nie znaleziono rezerwacji.");
        if (booking.guestUserId === userId)
            return this.trip(userId, reference);
        if (booking.guestUserId && booking.guestUserId !== userId) {
            throw new BookingAlreadyClaimedError();
        }
        if (booking.guestEmail.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
            throw new BookingEmailMismatchError();
        }
        await this.database.db
            .update(schema_1.bookings)
            .set({ guestUserId: userId, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.id, bookingId), (0, drizzle_orm_1.sql) `${schema_1.bookings.guestUserId} IS NULL`));
        this.logger.log({ event: "booking.claimed", bookingId, userId });
        return this.trip(userId, reference);
    }
};
exports.AccountService = AccountService;
exports.AccountService = AccountService = AccountService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object, users_service_1.UsersService,
        hosts_service_1.HostsService,
        guest_access_service_1.GuestAccessService])
], AccountService);
function statusesFor(category) {
    switch (category) {
        case "PENDING":
            return ["PENDING_HOST_APPROVAL", "PENDING_PAYMENT"];
        case "CANCELLED":
            return ["CANCELLED", "EXPIRED"];
        default:
            return ["CONFIRMED", "COMPLETED"];
    }
}
function encodeCursor(createdAt, id) {
    return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor) {
    try {
        const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
        const createdAt = new Date(iso);
        if (!id || Number.isNaN(createdAt.getTime()))
            return null;
        return { createdAt, id };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=account.service.js.map