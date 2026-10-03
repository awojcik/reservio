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
exports.HostsService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
let HostsService = class HostsService {
    database;
    constructor(database) {
        this.database = database;
    }
    async findByUserId(userId, executor = this.database.db) {
        const [host] = await executor
            .select()
            .from(schema_1.hosts)
            .where((0, drizzle_orm_1.eq)(schema_1.hosts.userId, userId))
            .limit(1);
        return host ?? null;
    }
    async create(input, executor = this.database.db) {
        const [host] = await executor
            .insert(schema_1.hosts)
            .values({ userId: input.userId, displayName: input.displayName.trim() })
            .returning();
        return host;
    }
};
exports.HostsService = HostsService;
exports.HostsService = HostsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], HostsService);
//# sourceMappingURL=hosts.service.js.map