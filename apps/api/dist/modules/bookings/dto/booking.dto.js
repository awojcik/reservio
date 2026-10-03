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
exports.HostBookingsPageDto = exports.HostBookingsQueryDto = exports.HOST_BOOKING_SORTS = exports.GuestAccessDto = exports.HostBookingDto = exports.BookingDto = exports.BookingActionsDto = exports.BookingTimelineEntryDto = exports.BookingPriceDto = exports.CreateBookingDto = exports.GuestDetailsDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const payment_dto_1 = require("../../payments/dto/payment.dto");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const schema_1 = require("../../../infrastructure/database/schema");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }) => typeof value === "string" ? value.trim() : value;
class GuestDetailsDto {
    name;
    email;
    phone;
}
exports.GuestDetailsDto = GuestDetailsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Jan Kowalski" }),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2, { message: "Podaj imię i nazwisko" }),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], GuestDetailsDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "jan@example.com" }),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)),
    (0, class_validator_1.IsEmail)({}, { message: "Podaj poprawny adres email" }),
    (0, class_validator_1.MaxLength)(254),
    __metadata("design:type", String)
], GuestDetailsDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "+48 600 100 200" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], GuestDetailsDto.prototype, "phone", void 0);
class CreateBookingDto {
    propertyId;
    checkIn;
    checkOut;
    adults;
    children;
    guest;
}
exports.CreateBookingDto = CreateBookingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateBookingDto.prototype, "propertyId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-12" }),
    (0, class_validator_1.Matches)(DATE, { message: "checkIn musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], CreateBookingDto.prototype, "checkIn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-16", description: "Dzień wyjazdu (exclusive)" }),
    (0, class_validator_1.Matches)(DATE, { message: "checkOut musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], CreateBookingDto.prototype, "checkOut", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 2, minimum: 1 }),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(50),
    __metadata("design:type", Number)
], CreateBookingDto.prototype, "adults", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1, minimum: 0, default: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(50),
    __metadata("design:type", Number)
], CreateBookingDto.prototype, "children", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: GuestDetailsDto }),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => GuestDetailsDto),
    __metadata("design:type", GuestDetailsDto)
], CreateBookingDto.prototype, "guest", void 0);
class BookingPriceDto {
    accommodationAmountMinor;
    cleaningFeeAmountMinor;
    serviceFeeAmountMinor;
    taxAmountMinor;
    discountAmountMinor;
    totalAmountMinor;
    currency;
}
exports.BookingPriceDto = BookingPriceDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 180000 }),
    __metadata("design:type", Number)
], BookingPriceDto.prototype, "accommodationAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 12000 }),
    __metadata("design:type", Number)
], BookingPriceDto.prototype, "cleaningFeeAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0, description: "Zarezerwowane na przyszłość" }),
    __metadata("design:type", Number)
], BookingPriceDto.prototype, "serviceFeeAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0, description: "Zarezerwowane na przyszłość" }),
    __metadata("design:type", Number)
], BookingPriceDto.prototype, "taxAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0, description: "Zarezerwowane na przyszłość" }),
    __metadata("design:type", Number)
], BookingPriceDto.prototype, "discountAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 192000 }),
    __metadata("design:type", Number)
], BookingPriceDto.prototype, "totalAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "PLN" }),
    __metadata("design:type", String)
], BookingPriceDto.prototype, "currency", void 0);
class BookingTimelineEntryDto {
    type;
    actorType;
    createdAt;
}
exports.BookingTimelineEntryDto = BookingTimelineEntryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.BOOKING_EVENT_TYPES }),
    __metadata("design:type", String)
], BookingTimelineEntryDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.ACTOR_TYPES }),
    __metadata("design:type", String)
], BookingTimelineEntryDto.prototype, "actorType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-01T10:15:00.000Z" }),
    __metadata("design:type", String)
], BookingTimelineEntryDto.prototype, "createdAt", void 0);
class BookingActionsDto {
    canCancel;
    claimed;
    canPay;
}
exports.BookingActionsDto = BookingActionsDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: true,
        description: "Czy rezerwację można jeszcze anulować. Wyliczane przez backend.",
    }),
    __metadata("design:type", Boolean)
], BookingActionsDto.prototype, "canCancel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: false,
        description: "Czy rezerwacja jest już przypisana do konta. Anonimowa rezerwacja może zostać przypisana bezpiecznym claimem.",
    }),
    __metadata("design:type", Boolean)
], BookingActionsDto.prototype, "claimed", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: true,
        description: "Czy można rozpocząć albo ponowić płatność. Wymaga aktywnej blokady terminu — po jej wygaśnięciu ponowienie nie jest możliwe.",
    }),
    __metadata("design:type", Boolean)
], BookingActionsDto.prototype, "canPay", void 0);
class BookingDto {
    reference;
    status;
    statusReason;
    bookingMode;
    propertyTitle;
    checkIn;
    checkOut;
    adults;
    children;
    price;
    holdExpiresAt;
    hostResponseDeadlineAt;
    createdAt;
    timeline;
    allowedActions;
    payment;
}
exports.BookingDto = BookingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "RZV-7KD2M9QP" }),
    __metadata("design:type", String)
], BookingDto.prototype, "reference", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.BOOKING_STATUSES }),
    __metadata("design:type", String)
], BookingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        enum: schema_1.BOOKING_STATUS_REASONS,
        example: "HOLD_EXPIRED",
    }),
    __metadata("design:type", Object)
], BookingDto.prototype, "statusReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.BOOKING_MODES }),
    __metadata("design:type", String)
], BookingDto.prototype, "bookingMode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Apartament nad morzem" }),
    __metadata("design:type", String)
], BookingDto.prototype, "propertyTitle", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-12" }),
    __metadata("design:type", String)
], BookingDto.prototype, "checkIn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-16" }),
    __metadata("design:type", String)
], BookingDto.prototype, "checkOut", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 2 }),
    __metadata("design:type", Number)
], BookingDto.prototype, "adults", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    __metadata("design:type", Number)
], BookingDto.prototype, "children", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BookingPriceDto }),
    __metadata("design:type", BookingPriceDto)
], BookingDto.prototype, "price", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        example: "2026-09-01T10:25:00.000Z",
        description: "Kiedy wygasa blokada terminu; null, gdy rezerwacja jej nie ma",
    }),
    __metadata("design:type", Object)
], BookingDto.prototype, "holdExpiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        example: "2026-09-02T10:15:00.000Z",
        description: "Do kiedy gospodarz może odpowiedzieć; null poza trybem prośby",
    }),
    __metadata("design:type", Object)
], BookingDto.prototype, "hostResponseDeadlineAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-01T10:15:00.000Z" }),
    __metadata("design:type", String)
], BookingDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [BookingTimelineEntryDto] }),
    __metadata("design:type", Array)
], BookingDto.prototype, "timeline", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BookingActionsDto }),
    __metadata("design:type", BookingActionsDto)
], BookingDto.prototype, "allowedActions", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: payment_dto_1.PaymentStateDto,
        nullable: true,
        description: "Stan płatności; null, dopóki płatność nie została rozpoczęta",
    }),
    __metadata("design:type", Object)
], BookingDto.prototype, "payment", void 0);
class HostBookingDto extends BookingDto {
    id;
    propertyId;
    guestName;
    guestEmail;
    guestPhone;
    hostRespondedAt;
}
exports.HostBookingDto = HostBookingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], HostBookingDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], HostBookingDto.prototype, "propertyId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Jan Kowalski" }),
    __metadata("design:type", String)
], HostBookingDto.prototype, "guestName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "jan@example.com" }),
    __metadata("design:type", String)
], HostBookingDto.prototype, "guestEmail", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], HostBookingDto.prototype, "guestPhone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], HostBookingDto.prototype, "hostRespondedAt", void 0);
class GuestAccessDto {
    token;
}
exports.GuestAccessDto = GuestAccessDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: "Token z linku w emailu. Wymieniany na cookie sesji gościa." }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], GuestAccessDto.prototype, "token", void 0);
exports.HOST_BOOKING_SORTS = [
    "NEWEST",
    "STAY_DATE_ASC",
    "STAY_DATE_DESC",
    "ACTION_REQUIRED",
];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
class HostBookingsQueryDto {
    status;
    propertyId;
    search;
    from;
    to;
    sort;
    limit;
    offset;
}
exports.HostBookingsQueryDto = HostBookingsQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: schema_1.BOOKING_STATUSES }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], HostBookingsQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ format: "uuid" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], HostBookingsQueryDto.prototype, "propertyId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: "RZV-7KD2M9QP",
        description: "Szuka po numerze rezerwacji, imieniu gościa albo adresie email",
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === "string" ? value.trim() : value)),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], HostBookingsQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "2026-09-01", description: "Pobyty kończące się od tej daty" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(DATE_ONLY, { message: "from musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], HostBookingsQueryDto.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "2026-10-01", description: "Pobyty zaczynające się przed tą datą" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(DATE_ONLY, { message: "to musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], HostBookingsQueryDto.prototype, "to", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: exports.HOST_BOOKING_SORTS, default: "NEWEST" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.HOST_BOOKING_SORTS),
    __metadata("design:type", String)
], HostBookingsQueryDto.prototype, "sort", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 20, default: 20, maximum: 100 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], HostBookingsQueryDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 0, default: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], HostBookingsQueryDto.prototype, "offset", void 0);
class HostBookingsPageDto {
    items;
    total;
    hasMore;
}
exports.HostBookingsPageDto = HostBookingsPageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [HostBookingDto] }),
    __metadata("design:type", Array)
], HostBookingsPageDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 42, description: "Liczba wszystkich pasujących rezerwacji" }),
    __metadata("design:type", Number)
], HostBookingsPageDto.prototype, "total", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: true }),
    __metadata("design:type", Boolean)
], HostBookingsPageDto.prototype, "hasMore", void 0);
//# sourceMappingURL=booking.dto.js.map