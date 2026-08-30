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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_service_1 = require("./auth.service");
const auth_guards_1 = require("./auth.guards");
const auth_dto_1 = require("./dto/auth.dto");
const sessions_service_1 = require("./sessions.service");
let AuthController = class AuthController {
    auth;
    sessions;
    constructor(auth, sessions) {
        this.auth = auth;
        this.sessions = sessions;
    }
    async register(dto, reply) {
        const { user, token } = await this.auth.register(dto);
        this.setSessionCookie(reply, token);
        return this.auth.describe(user);
    }
    async registerHost(dto, reply) {
        const { user, token } = await this.auth.registerHost(dto);
        this.setSessionCookie(reply, token);
        return this.auth.describe(user);
    }
    async login(dto, request, reply) {
        const { user, token } = await this.auth.login(dto, request.ip);
        this.setSessionCookie(reply, token);
        return this.auth.describe(user);
    }
    async logout(request, reply) {
        await this.auth.logout(request.cookies?.[this.sessions.cookieName]);
        reply.clearCookie(this.sessions.cookieName, { path: "/" });
    }
    me(user) {
        return this.auth.describe(user);
    }
    setSessionCookie(reply, token) {
        reply.setCookie(this.sessions.cookieName, token, {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            secure: process.env.NODE_ENV === "production",
            maxAge: this.sessions.ttlSeconds,
        });
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)("register"),
    (0, swagger_1.ApiOperation)({
        summary: "Rejestracja konta",
        description: "Tworzy User i sesję. Konto jest wspólne: ten sam User może rezerwować jako Guest i — po dodaniu profilu — wystawiać obiekty jako Host.",
    }),
    (0, swagger_1.ApiCreatedResponse)({ type: auth_dto_1.AuthSessionDto }),
    (0, swagger_1.ApiConflictResponse)({ description: "Adres email jest już zajęty" }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_dto_1.RegisterDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)("register/host"),
    (0, swagger_1.ApiOperation)({
        summary: "Rejestracja User wraz z profilem Host",
        description: "Zakłada konto i od razu profil gospodarza. Zwykła rejestracja tworzy sam User — profil Host jest opcjonalny i można go dodać później.",
    }),
    (0, swagger_1.ApiCreatedResponse)({ type: auth_dto_1.AuthSessionDto }),
    (0, swagger_1.ApiConflictResponse)({ description: "Adres email jest już zajęty" }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_dto_1.RegisterHostDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "registerHost", null);
__decorate([
    (0, common_1.Post)("login"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Logowanie",
        description: "Nie ujawnia, czy adres email istnieje — nieznane konto i błędne hasło dają tę samą odpowiedź.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: auth_dto_1.AuthSessionDto }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Nieprawidłowy email lub hasło" }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_dto_1.LoginDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)("logout"),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({
        summary: "Wylogowanie",
        description: "Unieważnia sesję w bazie i czyści cookie. Bezpieczne przy ponowieniu.",
    }),
    (0, swagger_1.ApiNoContentResponse)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)("me"),
    (0, common_1.UseGuards)(auth_guards_1.SessionGuard),
    (0, swagger_1.ApiOperation)({
        summary: "Aktualnie zalogowany User",
        description: "Jedyne źródło prawdy o stanie zalogowania dla frontendu.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: auth_dto_1.AuthSessionDto }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak aktywnej sesji" }),
    __param(0, (0, auth_guards_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)("auth"),
    (0, common_1.Controller)("auth"),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        sessions_service_1.SessionsService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map