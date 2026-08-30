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
var GuestAccessService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuestAccessService = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const TOKEN_BYTES = 32;
function hashToken(token) {
    return (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
}
let GuestAccessService = GuestAccessService_1 = class GuestAccessService {
    database;
    logger = new common_1.Logger(GuestAccessService_1.name);
    constructor(database) {
        this.database = database;
    }
    async issue(bookingId, executor = this.database.db) {
        const token = (0, node_crypto_1.randomBytes)(TOKEN_BYTES).toString("base64url");
        await executor.insert(schema_1.bookingGuestAccessTokens).values({
            bookingId,
            tokenHash: hashToken(token),
        });
        this.logger.log({ event: "guest_access.created", bookingId });
        return token;
    }
    async buildAccessUrl(bookingId, reference, baseUrl) {
        const token = await this.issue(bookingId);
        return `${baseUrl}/booking/status/${reference}?token=${token}`;
    }
    async verify(reference, token) {
        const tokenHash = hashToken(token);
        const [row] = await this.database.db
            .select({
            tokenId: schema_1.bookingGuestAccessTokens.id,
            storedHash: schema_1.bookingGuestAccessTokens.tokenHash,
            bookingId: schema_1.bookings.id,
            expiresAt: schema_1.bookingGuestAccessTokens.expiresAt,
        })
            .from(schema_1.bookingGuestAccessTokens)
            .innerJoin(schema_1.bookings, (0, drizzle_orm_1.eq)(schema_1.bookings.id, schema_1.bookingGuestAccessTokens.bookingId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingGuestAccessTokens.tokenHash, tokenHash), (0, drizzle_orm_1.eq)(schema_1.bookings.publicReference, reference), (0, drizzle_orm_1.isNull)(schema_1.bookingGuestAccessTokens.revokedAt)))
            .limit(1);
        if (!row)
            throw new common_1.UnauthorizedException("Nieprawidłowy link do rezerwacji.");
        if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
            throw new common_1.UnauthorizedException("Link do rezerwacji wygasł.");
        }
        const provided = Buffer.from(tokenHash);
        const stored = Buffer.from(row.storedHash);
        if (provided.length !== stored.length || !(0, node_crypto_1.timingSafeEqual)(provided, stored)) {
            throw new common_1.UnauthorizedException("Nieprawidłowy link do rezerwacji.");
        }
        await this.database.db
            .update(schema_1.bookingGuestAccessTokens)
            .set({ lastUsedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.bookingGuestAccessTokens.id, row.tokenId));
        this.logger.log({ event: "guest_access.used", bookingId: row.bookingId });
        return row.bookingId;
    }
    async revokeAll(bookingId) {
        await this.database.db
            .update(schema_1.bookingGuestAccessTokens)
            .set({ revokedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookingGuestAccessTokens.bookingId, bookingId), (0, drizzle_orm_1.isNull)(schema_1.bookingGuestAccessTokens.revokedAt)));
    }
};
exports.GuestAccessService = GuestAccessService;
exports.GuestAccessService = GuestAccessService = GuestAccessService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], GuestAccessService);
//# sourceMappingURL=guest-access.service.js.map