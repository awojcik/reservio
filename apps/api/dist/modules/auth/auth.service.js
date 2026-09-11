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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../../infrastructure/database/database.module");
const hosts_service_1 = require("../hosts/hosts.service");
const users_service_1 = require("../users/users.service");
const login_rate_limiter_1 = require("./login-rate-limiter");
const password_service_1 = require("./password.service");
const sessions_service_1 = require("./sessions.service");
const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(error) {
    const codes = [
        error.code,
        (error.cause ?? {}).code,
    ];
    return codes.includes(UNIQUE_VIOLATION);
}
const INVALID_CREDENTIALS = "Nieprawidłowy email lub hasło.";
let AuthService = AuthService_1 = class AuthService {
    database;
    users;
    hosts;
    passwords;
    sessions;
    rateLimiter;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(database, users, hosts, passwords, sessions, rateLimiter) {
        this.database = database;
        this.users = users;
        this.hosts = hosts;
        this.passwords = passwords;
        this.sessions = sessions;
        this.rateLimiter = rateLimiter;
    }
    async register(dto) {
        return this.createAccount(dto, null);
    }
    async registerHost(dto) {
        return this.createAccount(dto, dto.displayName);
    }
    async createAccount(dto, hostDisplayName) {
        if (await this.users.findByEmail(dto.email)) {
            throw new common_1.ConflictException("Konto z tym adresem email już istnieje.");
        }
        const passwordHash = await this.passwords.hash(dto.password);
        try {
            const result = await this.database.db.transaction(async (tx) => {
                const user = await this.users.create({
                    email: dto.email,
                    passwordHash,
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    phone: dto.phone,
                }, tx);
                const host = hostDisplayName
                    ? await this.hosts.create({ userId: user.id, displayName: hostDisplayName }, tx)
                    : null;
                const token = await this.sessions.create(user.id, tx);
                return { user, host, token };
            });
            this.logger.log({
                event: "auth.registered",
                userId: result.user.id,
                hostId: result.host?.id ?? null,
            });
            return result;
        }
        catch (error) {
            if (isUniqueViolation(error)) {
                throw new common_1.ConflictException("Konto z tym adresem email już istnieje.");
            }
            throw error;
        }
    }
    async login(dto, clientKey) {
        const email = (0, users_service_1.normaliseEmail)(dto.email);
        if (this.rateLimiter.blocked(email, clientKey)) {
            this.logger.warn({ event: "auth.login.rate_limited" });
            throw new common_1.UnauthorizedException(INVALID_CREDENTIALS);
        }
        const user = await this.users.findByEmail(email);
        const valid = await this.passwords.verifyOrDummy(user?.passwordHash ?? null, dto.password);
        if (!user || !valid) {
            this.rateLimiter.recordFailure(email, clientKey);
            this.logger.warn({ event: "auth.login.failed" });
            throw new common_1.UnauthorizedException(INVALID_CREDENTIALS);
        }
        this.rateLimiter.reset(email);
        const host = await this.hosts.findByUserId(user.id);
        const token = await this.sessions.create(user.id);
        this.logger.log({ event: "auth.login.succeeded", userId: user.id });
        return { user, host, token };
    }
    async logout(token) {
        if (token)
            await this.sessions.revoke(token);
    }
    async describe(user) {
        const [profile, host] = await Promise.all([
            this.users.findById(user.id),
            this.hosts.findByUserId(user.id),
        ]);
        return {
            user: {
                id: user.id,
                email: profile?.email ?? user.email,
                firstName: profile?.firstName ?? null,
                lastName: profile?.lastName ?? null,
                phone: profile?.phone ?? null,
                preferredLocale: profile?.preferredLocale ?? null,
            },
            host: host ? { id: host.id, displayName: host.displayName } : null,
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object, users_service_1.UsersService,
        hosts_service_1.HostsService,
        password_service_1.PasswordService,
        sessions_service_1.SessionsService,
        login_rate_limiter_1.LoginRateLimiter])
], AuthService);
//# sourceMappingURL=auth.service.js.map