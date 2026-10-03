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
exports.UsersService = void 0;
exports.normaliseEmail = normaliseEmail;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
function normaliseEmail(email) {
    return email.trim().toLowerCase();
}
let UsersService = class UsersService {
    database;
    constructor(database) {
        this.database = database;
    }
    async findByEmail(email, executor = this.database.db) {
        const [user] = await executor
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.email, normaliseEmail(email)))
            .limit(1);
        return user ?? null;
    }
    async findById(id) {
        const [user] = await this.database.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, id))
            .limit(1);
        return user ?? null;
    }
    async create(input, executor = this.database.db) {
        const [user] = await executor
            .insert(schema_1.users)
            .values({
            email: normaliseEmail(input.email),
            passwordHash: input.passwordHash,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            phone: input.phone ?? null,
        })
            .returning();
        return user;
    }
    async updateProfile(id, patch) {
        const [user] = await this.database.db
            .update(schema_1.users)
            .set({ ...patch, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, id))
            .returning();
        return user;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], UsersService);
//# sourceMappingURL=users.service.js.map