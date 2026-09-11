"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginRateLimiter = void 0;
const common_1 = require("@nestjs/common");
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IDENTIFIER = 10;
const MAX_PER_IP = 30;
const COOLDOWN_MS = 15 * 60 * 1000;
let LoginRateLimiter = class LoginRateLimiter {
    identifiers = new Map();
    addresses = new Map();
    blocked(email, ip) {
        return (this.tripped(this.identifiers, email, MAX_PER_IDENTIFIER) ||
            this.tripped(this.addresses, ip, MAX_PER_IP));
    }
    recordFailure(email, ip) {
        this.bump(this.identifiers, email);
        this.bump(this.addresses, ip);
    }
    reset(email) {
        this.identifiers.delete(email);
    }
    tripped(buckets, key, max) {
        const entry = buckets.get(key);
        if (!entry)
            return false;
        if (entry.resetAt <= Date.now()) {
            buckets.delete(key);
            return false;
        }
        return entry.count >= max;
    }
    bump(buckets, key) {
        const now = Date.now();
        const entry = buckets.get(key);
        if (!entry || entry.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
            this.sweep(buckets, now);
            return;
        }
        entry.count += 1;
        if (entry.count === MAX_PER_IDENTIFIER || entry.count === MAX_PER_IP) {
            entry.resetAt = now + COOLDOWN_MS;
        }
    }
    sweep(buckets, now) {
        for (const [key, entry] of buckets) {
            if (entry.resetAt <= now)
                buckets.delete(key);
        }
    }
};
exports.LoginRateLimiter = LoginRateLimiter;
exports.LoginRateLimiter = LoginRateLimiter = __decorate([
    (0, common_1.Injectable)()
], LoginRateLimiter);
//# sourceMappingURL=login-rate-limiter.js.map