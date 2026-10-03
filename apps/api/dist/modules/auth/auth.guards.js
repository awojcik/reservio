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
var AdminGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentHost = exports.CurrentUser = exports.AdminGuard = exports.HostGuard = exports.SessionGuard = void 0;
const common_1 = require("@nestjs/common");
const app_error_1 = require("../../common/app-error");
const request_context_1 = require("../../infrastructure/security/request-context");
const hosts_service_1 = require("../hosts/hosts.service");
const sessions_service_1 = require("./sessions.service");
let SessionGuard = class SessionGuard {
    sessions;
    constructor(sessions) {
        this.sessions = sessions;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const token = request.cookies?.[this.sessions.cookieName];
        if (!token)
            throw new common_1.UnauthorizedException("Wymagane zalogowanie.");
        const user = await this.sessions.resolve(token);
        if (!user)
            throw new common_1.UnauthorizedException("Sesja wygasła. Zaloguj się ponownie.");
        request.auth = { user, host: null };
        (0, request_context_1.setContextUserId)(user.id);
        return true;
    }
};
exports.SessionGuard = SessionGuard;
exports.SessionGuard = SessionGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sessions_service_1.SessionsService])
], SessionGuard);
let HostGuard = class HostGuard {
    sessions;
    hosts;
    constructor(sessions, hosts) {
        this.sessions = sessions;
        this.hosts = hosts;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const token = request.cookies?.[this.sessions.cookieName];
        if (!token)
            throw new common_1.UnauthorizedException("Wymagane zalogowanie.");
        const user = await this.sessions.resolve(token);
        if (!user)
            throw new common_1.UnauthorizedException("Sesja wygasła. Zaloguj się ponownie.");
        const host = await this.hosts.findByUserId(user.id);
        if (!host)
            throw new common_1.ForbiddenException("To konto nie ma profilu gospodarza.");
        request.auth = { user, host };
        (0, request_context_1.setContextUserId)(user.id);
        return true;
    }
};
exports.HostGuard = HostGuard;
exports.HostGuard = HostGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sessions_service_1.SessionsService,
        hosts_service_1.HostsService])
], HostGuard);
let AdminGuard = class AdminGuard {
    static { AdminGuard_1 = this; }
    sessions;
    static ROLES = ["SUPPORT", "ADMIN"];
    constructor(sessions) {
        this.sessions = sessions;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const token = request.cookies?.[this.sessions.cookieName];
        if (!token)
            throw new common_1.UnauthorizedException("Wymagane zalogowanie.");
        const user = await this.sessions.resolve(token);
        if (!user)
            throw new common_1.UnauthorizedException("Sesja wygasła. Zaloguj się ponownie.");
        if (!user.roles.some((role) => AdminGuard_1.ROLES.includes(role))) {
            throw new app_error_1.AppError(app_error_1.AppErrorCode.ADMIN_FORBIDDEN, "To konto nie ma uprawnień administracyjnych.", common_1.HttpStatus.FORBIDDEN);
        }
        request.auth = { user, host: null };
        (0, request_context_1.setContextUserId)(user.id);
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = AdminGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sessions_service_1.SessionsService])
], AdminGuard);
exports.CurrentUser = (0, common_1.createParamDecorator)((_data, context) => {
    const request = context.switchToHttp().getRequest();
    return request.auth.user;
});
exports.CurrentHost = (0, common_1.createParamDecorator)((_data, context) => {
    const request = context.switchToHttp().getRequest();
    return request.auth.host;
});
//# sourceMappingURL=auth.guards.js.map