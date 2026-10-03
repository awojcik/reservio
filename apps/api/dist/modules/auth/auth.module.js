"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const hosts_module_1 = require("../hosts/hosts.module");
const users_module_1 = require("../users/users.module");
const auth_controller_1 = require("./auth.controller");
const auth_guards_1 = require("./auth.guards");
const auth_service_1 = require("./auth.service");
const login_rate_limiter_1 = require("./login-rate-limiter");
const password_service_1 = require("./password.service");
const sessions_service_1 = require("./sessions.service");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [users_module_1.UsersModule, hosts_module_1.HostsModule],
        controllers: [auth_controller_1.AuthController],
        providers: [
            auth_service_1.AuthService,
            password_service_1.PasswordService,
            sessions_service_1.SessionsService,
            login_rate_limiter_1.LoginRateLimiter,
            auth_guards_1.SessionGuard,
            auth_guards_1.HostGuard,
            auth_guards_1.AdminGuard,
        ],
        exports: [sessions_service_1.SessionsService, auth_guards_1.SessionGuard, auth_guards_1.HostGuard, auth_guards_1.AdminGuard, hosts_module_1.HostsModule, users_module_1.UsersModule],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map