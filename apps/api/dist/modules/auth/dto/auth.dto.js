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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthSessionDto = exports.AuthHostDto = exports.AuthUserDto = exports.LoginDto = exports.RegisterHostDto = exports.RegisterDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const password_service_1 = require("../password.service");
const trimmed = ({ value }) => typeof value === "string" ? value.trim() : value;
const normalisedEmail = ({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value;
class RegisterDto {
    firstName;
    lastName;
    phone;
    email;
    password;
}
exports.RegisterDto = RegisterDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Anna" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], RegisterDto.prototype, "firstName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Kowalska" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], RegisterDto.prototype, "lastName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "+48 600 100 200" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], RegisterDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "anna@example.com" }),
    (0, class_transformer_1.Transform)(normalisedEmail),
    (0, class_validator_1.IsEmail)({}, { message: "Podaj poprawny adres email" }),
    (0, class_validator_1.MaxLength)(254),
    __metadata("design:type", String)
], RegisterDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "bardzo-bezpieczne-haslo", minLength: password_service_1.MIN_PASSWORD_LENGTH }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(password_service_1.MIN_PASSWORD_LENGTH, {
        message: `Hasło musi mieć co najmniej ${password_service_1.MIN_PASSWORD_LENGTH} znaków`,
    }),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], RegisterDto.prototype, "password", void 0);
class RegisterHostDto extends RegisterDto {
    displayName;
}
exports.RegisterHostDto = RegisterHostDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Anna Kowalska" }),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2, { message: "Nazwa gospodarza musi mieć co najmniej 2 znaki" }),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], RegisterHostDto.prototype, "displayName", void 0);
class LoginDto {
    email;
    password;
}
exports.LoginDto = LoginDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "anna@example.com" }),
    (0, class_transformer_1.Transform)(normalisedEmail),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(254),
    __metadata("design:type", String)
], LoginDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "bardzo-bezpieczne-haslo" }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], LoginDto.prototype, "password", void 0);
class AuthUserDto {
    id;
    email;
    firstName;
    lastName;
    phone;
    preferredLocale;
}
exports.AuthUserDto = AuthUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], AuthUserDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "anna@example.com", description: "Tożsamość logowania" }),
    __metadata("design:type", String)
], AuthUserDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "Anna" }),
    __metadata("design:type", Object)
], AuthUserDto.prototype, "firstName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "Kowalska" }),
    __metadata("design:type", Object)
], AuthUserDto.prototype, "lastName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "+48 600 100 200" }),
    __metadata("design:type", Object)
], AuthUserDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "pl" }),
    __metadata("design:type", Object)
], AuthUserDto.prototype, "preferredLocale", void 0);
class AuthHostDto {
    id;
    displayName;
}
exports.AuthHostDto = AuthHostDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], AuthHostDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Anna Kowalska" }),
    __metadata("design:type", String)
], AuthHostDto.prototype, "displayName", void 0);
class AuthSessionDto {
    user;
    host;
}
exports.AuthSessionDto = AuthSessionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: AuthUserDto }),
    __metadata("design:type", AuthUserDto)
], AuthSessionDto.prototype, "user", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: AuthHostDto,
        nullable: true,
        description: "Profil Host; null dla User, który nie jest jeszcze gospodarzem",
    }),
    __metadata("design:type", Object)
], AuthSessionDto.prototype, "host", void 0);
//# sourceMappingURL=auth.dto.js.map