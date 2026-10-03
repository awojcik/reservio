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
exports.DatabaseModule = exports.DATABASE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const connection_1 = require("./connection");
exports.DATABASE = Symbol("DATABASE");
let DatabaseModule = class DatabaseModule {
    database;
    constructor(database) {
        this.database = database;
    }
    async onApplicationShutdown() {
        await this.database.client.end({ timeout: 5 });
    }
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: exports.DATABASE,
                inject: [config_1.ConfigService],
                useFactory: (config) => {
                    const url = config.get("DATABASE_URL");
                    if (!url)
                        throw new Error("DATABASE_URL is not set");
                    return (0, connection_1.createDatabase)(url);
                },
            },
        ],
        exports: [exports.DATABASE],
    }),
    __param(0, (0, common_1.Inject)(exports.DATABASE)),
    __metadata("design:paramtypes", [Object])
], DatabaseModule);
//# sourceMappingURL=database.module.js.map