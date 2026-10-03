"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingSettlements = exports.SETTLEMENT_STATUSES = exports.bookingMessages = exports.MESSAGE_SENDER_TYPES = exports.bookingConversations = exports.propertySensitiveAccess = exports.propertyStayInformation = exports.hostPaymentAccounts = exports.HOST_PAYMENT_READINESS = exports.paymentProviderEvents = exports.refunds = exports.REFUND_REASONS = exports.REFUND_STATUSES = exports.REFUND_TYPES = exports.payments = exports.OPEN_PAYMENT_STATUSES = exports.PAYMENT_STATUSES = exports.PAYMENT_PROVIDERS = exports.outboxEvents = exports.OUTBOX_STATUSES = exports.notificationDeliveries = exports.NOTIFICATION_STATUSES = exports.NOTIFICATION_TYPES = exports.bookingEvents = exports.ACTOR_TYPES = exports.BOOKING_EVENT_TYPES = exports.bookingGuestAccessTokens = exports.BOOKING_STATUS_REASONS = exports.calendarExportTokens = exports.availabilityBlocks = exports.idempotencyKeys = exports.bookingHolds = exports.bookings = exports.BOOKING_HOLD_STATUSES = exports.BOOKING_STATUSES = exports.BOOKING_MODES = exports.externalCalendars = exports.EXTERNAL_CALENDAR_STATUSES = exports.EXTERNAL_CALENDAR_PROVIDERS = exports.AVAILABILITY_SOURCE_TYPES = exports.propertyAmenities = exports.amenities = exports.propertyImages = exports.properties = exports.hosts = exports.userSessions = exports.users = exports.USER_ROLES = exports.PROPERTY_TYPES = exports.PROPERTY_STATUSES = void 0;
exports.externalSyncAttempts = exports.SYNC_STATUSES = exports.SYNC_TYPES = exports.externalProviderEvents = exports.externalReservationMappings = exports.RESERVATION_MAPPING_STATUSES = exports.RESERVATION_DIRECTIONS = exports.externalPropertyMappings = exports.MAPPING_STATUSES = exports.externalInventoryConnections = exports.CONNECTION_STATUS_REASONS = exports.CONNECTION_STATUSES = exports.EXTERNAL_PROVIDERS = exports.adminActions = exports.ADMIN_ACTION_STATUSES = exports.ADMIN_ACTION_TARGETS = exports.ADMIN_ACTION_TYPES = exports.hostPayouts = exports.PAYOUT_STATUSES = exports.hostTransferReversals = exports.REVERSAL_REASONS = exports.REVERSAL_STATUSES = exports.hostTransfers = exports.TRANSFER_STATUSES = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const daterange = (0, pg_core_1.customType)({
    dataType: () => "daterange",
});
exports.PROPERTY_STATUSES = [
    "DRAFT",
    "IN_REVIEW",
    "PUBLISHED",
    "SUSPENDED",
    "ARCHIVED",
];
exports.PROPERTY_TYPES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO"];
exports.USER_ROLES = ["SUPPORT", "ADMIN"];
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    email: (0, pg_core_1.text)("email").notNull(),
    passwordHash: (0, pg_core_1.text)("password_hash").notNull(),
    firstName: (0, pg_core_1.text)("first_name"),
    lastName: (0, pg_core_1.text)("last_name"),
    phone: (0, pg_core_1.text)("phone"),
    preferredLocale: (0, pg_core_1.text)("preferred_locale"),
    roles: (0, pg_core_1.text)("roles").array().notNull().default((0, drizzle_orm_1.sql) `'{}'::text[]`),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("users_email_key").on(table.email),
    (0, pg_core_1.check)("users_email_lowercase_check", (0, drizzle_orm_1.sql) `${table.email} = lower(${table.email})`),
    (0, pg_core_1.check)("users_roles_check", (0, drizzle_orm_1.sql) `${table.roles} <@ ARRAY['SUPPORT','ADMIN']::text[]`),
]);
exports.userSessions = (0, pg_core_1.pgTable)("user_sessions", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)("user_id")
        .notNull()
        .references(() => exports.users.id, { onDelete: "cascade" }),
    tokenHash: (0, pg_core_1.text)("token_hash").notNull(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: (0, pg_core_1.timestamp)("last_seen_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("user_sessions_token_hash_key").on(table.tokenHash),
    (0, pg_core_1.index)("user_sessions_user_idx").on(table.userId),
    (0, pg_core_1.index)("user_sessions_expires_at_idx").on(table.expiresAt),
]);
exports.hosts = (0, pg_core_1.pgTable)("hosts", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)("user_id").references(() => exports.users.id, { onDelete: "restrict" }),
    displayName: (0, pg_core_1.text)("display_name").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [(0, pg_core_1.uniqueIndex)("hosts_user_id_key").on(table.userId)]);
exports.properties = (0, pg_core_1.pgTable)("properties", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "restrict" }),
    slug: (0, pg_core_1.text)("slug").notNull(),
    title: (0, pg_core_1.text)("title").notNull(),
    description: (0, pg_core_1.text)("description"),
    propertyType: (0, pg_core_1.text)("property_type").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("DRAFT"),
    bookingMode: (0, pg_core_1.text)("booking_mode").notNull().default("REQUEST_TO_BOOK"),
    addressLine1: (0, pg_core_1.text)("address_line1"),
    postalCode: (0, pg_core_1.text)("postal_code"),
    city: (0, pg_core_1.text)("city").notNull().default(""),
    district: (0, pg_core_1.text)("district").notNull().default(""),
    countryCode: (0, pg_core_1.text)("country_code").notNull().default("PL"),
    timeZone: (0, pg_core_1.text)("time_zone").notNull().default("Europe/Warsaw"),
    latitude: (0, pg_core_1.real)("latitude"),
    longitude: (0, pg_core_1.real)("longitude"),
    maxGuests: (0, pg_core_1.integer)("max_guests").notNull().default(1),
    bedrooms: (0, pg_core_1.integer)("bedrooms").notNull().default(0),
    beds: (0, pg_core_1.integer)("beds").notNull().default(0),
    bathrooms: (0, pg_core_1.integer)("bathrooms").notNull().default(0),
    rating: (0, pg_core_1.real)("rating").notNull().default(0),
    reviewCount: (0, pg_core_1.integer)("review_count").notNull().default(0),
    distanceToBeachMeters: (0, pg_core_1.integer)("distance_to_beach_meters"),
    baseDailyRateAmountMinor: (0, pg_core_1.integer)("base_daily_rate_amount_minor").notNull().default(0),
    cleaningFeeAmountMinor: (0, pg_core_1.integer)("cleaning_fee_amount_minor").notNull().default(0),
    marketDailyRateAmountMinor: (0, pg_core_1.integer)("market_daily_rate_amount_minor"),
    currency: (0, pg_core_1.text)("currency").notNull().default("PLN"),
    firstPublishedAt: (0, pg_core_1.timestamp)("first_published_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("properties_slug_key").on(table.slug),
    (0, pg_core_1.index)("properties_status_idx").on(table.status),
    (0, pg_core_1.index)("properties_city_idx").on(table.city),
    (0, pg_core_1.index)("properties_property_type_idx").on(table.propertyType),
    (0, pg_core_1.index)("properties_host_id_idx").on(table.hostId),
    (0, pg_core_1.check)("properties_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('DRAFT','IN_REVIEW','PUBLISHED','SUSPENDED','ARCHIVED')`),
    (0, pg_core_1.check)("properties_type_check", (0, drizzle_orm_1.sql) `${table.propertyType} IN ('APARTMENT','HOUSE','VILLA','STUDIO')`),
    (0, pg_core_1.check)("properties_booking_mode_check", (0, drizzle_orm_1.sql) `${table.bookingMode} IN ('REQUEST_TO_BOOK','INSTANT_BOOK')`),
    (0, pg_core_1.check)("properties_max_guests_check", (0, drizzle_orm_1.sql) `${table.maxGuests} > 0`),
    (0, pg_core_1.check)("properties_bedrooms_check", (0, drizzle_orm_1.sql) `${table.bedrooms} >= 0`),
    (0, pg_core_1.check)("properties_beds_check", (0, drizzle_orm_1.sql) `${table.beds} >= 0`),
    (0, pg_core_1.check)("properties_bathrooms_check", (0, drizzle_orm_1.sql) `${table.bathrooms} >= 0`),
    (0, pg_core_1.check)("properties_rating_check", (0, drizzle_orm_1.sql) `${table.rating} >= 0 AND ${table.rating} <= 10`),
    (0, pg_core_1.check)("properties_review_count_check", (0, drizzle_orm_1.sql) `${table.reviewCount} >= 0`),
    (0, pg_core_1.check)("properties_base_rate_check", (0, drizzle_orm_1.sql) `${table.baseDailyRateAmountMinor} >= 0`),
    (0, pg_core_1.check)("properties_cleaning_fee_check", (0, drizzle_orm_1.sql) `${table.cleaningFeeAmountMinor} >= 0`),
    (0, pg_core_1.check)("properties_currency_check", (0, drizzle_orm_1.sql) `${table.currency} IN ('PLN','EUR','USD','GBP')`),
    (0, pg_core_1.check)("properties_latitude_check", (0, drizzle_orm_1.sql) `${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`),
    (0, pg_core_1.check)("properties_longitude_check", (0, drizzle_orm_1.sql) `${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`),
    (0, pg_core_1.check)("properties_market_rate_check", (0, drizzle_orm_1.sql) `${table.marketDailyRateAmountMinor} IS NULL OR ${table.marketDailyRateAmountMinor} >= 0`),
    (0, pg_core_1.check)("properties_beach_distance_check", (0, drizzle_orm_1.sql) `${table.distanceToBeachMeters} IS NULL OR ${table.distanceToBeachMeters} >= 0`),
]);
exports.propertyImages = (0, pg_core_1.pgTable)("property_images", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    objectKey: (0, pg_core_1.text)("object_key"),
    url: (0, pg_core_1.text)("url"),
    altText: (0, pg_core_1.text)("alt_text"),
    position: (0, pg_core_1.integer)("position").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("property_images_property_position_key").on(table.propertyId, table.position),
    (0, pg_core_1.uniqueIndex)("property_images_object_key_key").on(table.objectKey),
    (0, pg_core_1.check)("property_images_position_check", (0, drizzle_orm_1.sql) `${table.position} >= 0`),
    (0, pg_core_1.check)("property_images_source_check", (0, drizzle_orm_1.sql) `${table.objectKey} IS NOT NULL OR ${table.url} IS NOT NULL`),
]);
exports.amenities = (0, pg_core_1.pgTable)("amenities", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    code: (0, pg_core_1.text)("code").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [(0, pg_core_1.uniqueIndex)("amenities_code_key").on(table.code)]);
exports.propertyAmenities = (0, pg_core_1.pgTable)("property_amenities", {
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    amenityId: (0, pg_core_1.uuid)("amenity_id")
        .notNull()
        .references(() => exports.amenities.id, { onDelete: "cascade" }),
}, (table) => [
    (0, pg_core_1.primaryKey)({ columns: [table.propertyId, table.amenityId] }),
    (0, pg_core_1.index)("property_amenities_amenity_idx").on(table.amenityId),
]);
exports.AVAILABILITY_SOURCE_TYPES = [
    "HOST_BLOCK",
    "EXTERNAL_CALENDAR",
    "BOOKING",
    "BOOKING_HOLD",
    "MAINTENANCE",
    "EXTERNAL_PROVIDER",
];
exports.EXTERNAL_CALENDAR_PROVIDERS = [
    "BOOKING",
    "AIRBNB",
    "VRBO",
    "PMS",
    "OTHER",
];
exports.EXTERNAL_CALENDAR_STATUSES = ["ACTIVE", "DISABLED"];
exports.externalCalendars = (0, pg_core_1.pgTable)("external_calendars", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider").notNull(),
    name: (0, pg_core_1.text)("name").notNull(),
    importUrlEncrypted: (0, pg_core_1.text)("import_url_encrypted").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("ACTIVE"),
    lastSyncStartedAt: (0, pg_core_1.timestamp)("last_sync_started_at", { withTimezone: true }),
    lastSyncSucceededAt: (0, pg_core_1.timestamp)("last_sync_succeeded_at", { withTimezone: true }),
    lastSyncFailedAt: (0, pg_core_1.timestamp)("last_sync_failed_at", { withTimezone: true }),
    lastErrorCode: (0, pg_core_1.text)("last_error_code"),
    lastErrorMessage: (0, pg_core_1.text)("last_error_message"),
    consecutiveFailures: (0, pg_core_1.integer)("consecutive_failures").notNull().default(0),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.index)("external_calendars_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("external_calendars_status_idx").on(table.status, table.lastSyncSucceededAt),
    (0, pg_core_1.check)("external_calendars_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('BOOKING','AIRBNB','VRBO','PMS','OTHER')`),
    (0, pg_core_1.check)("external_calendars_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('ACTIVE','DISABLED')`),
    (0, pg_core_1.check)("external_calendars_failures_check", (0, drizzle_orm_1.sql) `${table.consecutiveFailures} >= 0`),
]);
exports.BOOKING_MODES = ["REQUEST_TO_BOOK", "INSTANT_BOOK"];
exports.BOOKING_STATUSES = [
    "PENDING_HOST_APPROVAL",
    "PENDING_PAYMENT",
    "CONFIRMED",
    "CANCELLED",
    "EXPIRED",
    "COMPLETED",
];
exports.BOOKING_HOLD_STATUSES = ["ACTIVE", "RELEASED", "EXPIRED", "CONVERTED"];
exports.bookings = (0, pg_core_1.pgTable)("bookings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    publicReference: (0, pg_core_1.text)("public_reference").notNull(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "restrict" }),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "restrict" }),
    bookingMode: (0, pg_core_1.text)("booking_mode").notNull(),
    status: (0, pg_core_1.text)("status").notNull(),
    statusReason: (0, pg_core_1.text)("status_reason"),
    checkIn: (0, pg_core_1.date)("check_in").notNull(),
    checkOut: (0, pg_core_1.date)("check_out").notNull(),
    adults: (0, pg_core_1.integer)("adults").notNull(),
    children: (0, pg_core_1.integer)("children").notNull().default(0),
    guestUserId: (0, pg_core_1.uuid)("guest_user_id").references(() => exports.users.id, {
        onDelete: "set null",
    }),
    guestName: (0, pg_core_1.text)("guest_name").notNull(),
    guestEmail: (0, pg_core_1.text)("guest_email").notNull(),
    guestPhone: (0, pg_core_1.text)("guest_phone"),
    propertyTitleSnapshot: (0, pg_core_1.text)("property_title_snapshot").notNull(),
    propertyCitySnapshot: (0, pg_core_1.text)("property_city_snapshot"),
    coverImageUrlSnapshot: (0, pg_core_1.text)("cover_image_url_snapshot"),
    accommodationAmountMinor: (0, pg_core_1.integer)("accommodation_amount_minor").notNull(),
    cleaningFeeAmountMinor: (0, pg_core_1.integer)("cleaning_fee_amount_minor").notNull(),
    serviceFeeAmountMinor: (0, pg_core_1.integer)("service_fee_amount_minor").notNull().default(0),
    taxAmountMinor: (0, pg_core_1.integer)("tax_amount_minor").notNull().default(0),
    discountAmountMinor: (0, pg_core_1.integer)("discount_amount_minor").notNull().default(0),
    totalAmountMinor: (0, pg_core_1.integer)("total_amount_minor").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    hostResponseDeadlineAt: (0, pg_core_1.timestamp)("host_response_deadline_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    hostRespondedAt: (0, pg_core_1.timestamp)("host_responded_at", { withTimezone: true }),
    cancelledAt: (0, pg_core_1.timestamp)("cancelled_at", { withTimezone: true }),
    expiredAt: (0, pg_core_1.timestamp)("expired_at", { withTimezone: true }),
    confirmedAt: (0, pg_core_1.timestamp)("confirmed_at", { withTimezone: true }),
    sensitiveAccessRevealedAt: (0, pg_core_1.timestamp)("sensitive_access_revealed_at", {
        withTimezone: true,
    }),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("bookings_public_reference_key").on(table.publicReference),
    (0, pg_core_1.index)("bookings_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("bookings_host_idx").on(table.hostId),
    (0, pg_core_1.index)("bookings_status_idx").on(table.status),
    (0, pg_core_1.index)("bookings_created_at_idx").on(table.createdAt),
    (0, pg_core_1.index)("bookings_host_response_deadline_idx").on(table.hostResponseDeadlineAt),
    (0, pg_core_1.index)("bookings_guest_user_idx").on(table.guestUserId),
    (0, pg_core_1.index)("bookings_host_status_check_in_idx").on(table.hostId, table.status, table.checkIn),
    (0, pg_core_1.index)("bookings_host_check_out_idx").on(table.hostId, table.checkOut),
    (0, pg_core_1.check)("bookings_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED','CANCELLED','EXPIRED','COMPLETED')`),
    (0, pg_core_1.check)("bookings_mode_check", (0, drizzle_orm_1.sql) `${table.bookingMode} IN ('REQUEST_TO_BOOK','INSTANT_BOOK')`),
    (0, pg_core_1.check)("bookings_stay_check", (0, drizzle_orm_1.sql) `${table.checkOut} > ${table.checkIn}`),
    (0, pg_core_1.check)("bookings_adults_check", (0, drizzle_orm_1.sql) `${table.adults} >= 1`),
    (0, pg_core_1.check)("bookings_children_check", (0, drizzle_orm_1.sql) `${table.children} >= 0`),
    (0, pg_core_1.check)("bookings_accommodation_check", (0, drizzle_orm_1.sql) `${table.accommodationAmountMinor} >= 0`),
    (0, pg_core_1.check)("bookings_cleaning_check", (0, drizzle_orm_1.sql) `${table.cleaningFeeAmountMinor} >= 0`),
    (0, pg_core_1.check)("bookings_service_fee_check", (0, drizzle_orm_1.sql) `${table.serviceFeeAmountMinor} >= 0`),
    (0, pg_core_1.check)("bookings_tax_check", (0, drizzle_orm_1.sql) `${table.taxAmountMinor} >= 0`),
    (0, pg_core_1.check)("bookings_discount_check", (0, drizzle_orm_1.sql) `${table.discountAmountMinor} >= 0`),
    (0, pg_core_1.check)("bookings_total_check", (0, drizzle_orm_1.sql) `${table.totalAmountMinor} >= 0`),
    (0, pg_core_1.check)("bookings_currency_check", (0, drizzle_orm_1.sql) `${table.currency} IN ('PLN','EUR','USD','GBP')`),
]);
exports.bookingHolds = (0, pg_core_1.pgTable)("booking_holds", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "cascade" }),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    dateRange: daterange("date_range").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("ACTIVE"),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: (0, pg_core_1.timestamp)("released_at", { withTimezone: true }),
    expiredAt: (0, pg_core_1.timestamp)("expired_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("booking_holds_booking_id_key").on(table.bookingId),
    (0, pg_core_1.index)("booking_holds_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("booking_holds_status_idx").on(table.status),
    (0, pg_core_1.index)("booking_holds_expires_at_idx").on(table.expiresAt),
    (0, pg_core_1.check)("booking_holds_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('ACTIVE','RELEASED','EXPIRED','CONVERTED')`),
    (0, pg_core_1.check)("booking_holds_range_check", (0, drizzle_orm_1.sql) `lower(${table.dateRange}) < upper(${table.dateRange})`),
]);
exports.idempotencyKeys = (0, pg_core_1.pgTable)("idempotency_keys", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    scope: (0, pg_core_1.text)("scope").notNull(),
    keyHash: (0, pg_core_1.text)("key_hash").notNull(),
    requestHash: (0, pg_core_1.text)("request_hash").notNull(),
    resourceType: (0, pg_core_1.text)("resource_type").notNull(),
    resourceId: (0, pg_core_1.uuid)("resource_id").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("idempotency_keys_scope_key").on(table.scope, table.keyHash),
    (0, pg_core_1.index)("idempotency_keys_expires_at_idx").on(table.expiresAt),
]);
exports.availabilityBlocks = (0, pg_core_1.pgTable)("availability_blocks", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    sourceType: (0, pg_core_1.text)("source_type").notNull(),
    dateRange: daterange("date_range").notNull(),
    externalCalendarId: (0, pg_core_1.uuid)("external_calendar_id").references(() => exports.externalCalendars.id, { onDelete: "cascade" }),
    externalEventUid: (0, pg_core_1.text)("external_event_uid"),
    bookingHoldId: (0, pg_core_1.uuid)("booking_hold_id").references(() => exports.bookingHolds.id, {
        onDelete: "cascade",
    }),
    bookingId: (0, pg_core_1.uuid)("booking_id").references(() => exports.bookings.id, {
        onDelete: "cascade",
    }),
    externalReservationMappingId: (0, pg_core_1.uuid)("external_reservation_mapping_id").references(() => exports.externalReservationMappings.id, { onDelete: "cascade" }),
    note: (0, pg_core_1.text)("note"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.index)("availability_blocks_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("availability_blocks_external_calendar_idx").on(table.externalCalendarId),
    (0, pg_core_1.index)("availability_blocks_booking_hold_idx").on(table.bookingHoldId),
    (0, pg_core_1.index)("availability_blocks_booking_idx").on(table.bookingId),
    (0, pg_core_1.uniqueIndex)("availability_blocks_external_reservation_key").on(table.externalReservationMappingId),
    (0, pg_core_1.check)("availability_blocks_source_check", (0, drizzle_orm_1.sql) `${table.sourceType} IN ('HOST_BLOCK','EXTERNAL_CALENDAR','BOOKING','BOOKING_HOLD','MAINTENANCE','EXTERNAL_PROVIDER')`),
    (0, pg_core_1.check)("availability_blocks_range_check", (0, drizzle_orm_1.sql) `lower(${table.dateRange}) < upper(${table.dateRange})`),
    (0, pg_core_1.check)("availability_blocks_external_link_check", (0, drizzle_orm_1.sql) `(${table.sourceType} = 'EXTERNAL_CALENDAR') = (${table.externalCalendarId} IS NOT NULL)`),
    (0, pg_core_1.check)("availability_blocks_hold_link_check", (0, drizzle_orm_1.sql) `(${table.sourceType} = 'BOOKING_HOLD') = (${table.bookingHoldId} IS NOT NULL)`),
    (0, pg_core_1.check)("availability_blocks_booking_link_check", (0, drizzle_orm_1.sql) `(${table.sourceType} = 'BOOKING') = (${table.bookingId} IS NOT NULL)`),
    (0, pg_core_1.check)("availability_blocks_external_reservation_link_check", (0, drizzle_orm_1.sql) `(${table.sourceType} = 'EXTERNAL_PROVIDER') = (${table.externalReservationMappingId} IS NOT NULL)`),
]);
exports.calendarExportTokens = (0, pg_core_1.pgTable)("calendar_export_tokens", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    tokenHash: (0, pg_core_1.text)("token_hash").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: (0, pg_core_1.timestamp)("revoked_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("calendar_export_tokens_token_hash_key").on(table.tokenHash),
    (0, pg_core_1.index)("calendar_export_tokens_property_idx").on(table.propertyId),
]);
exports.BOOKING_STATUS_REASONS = [
    "GUEST_CANCELLED",
    "HOST_CANCELLED",
    "HOST_REJECTED",
    "HOST_RESPONSE_TIMEOUT",
    "HOLD_EXPIRED",
    "AVAILABILITY_LOST",
    "PAYMENT_AFTER_HOLD_EXPIRY",
];
exports.bookingGuestAccessTokens = (0, pg_core_1.pgTable)("booking_guest_access_tokens", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "cascade" }),
    tokenHash: (0, pg_core_1.text)("token_hash").notNull(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true }),
    revokedAt: (0, pg_core_1.timestamp)("revoked_at", { withTimezone: true }),
    lastUsedAt: (0, pg_core_1.timestamp)("last_used_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("booking_guest_access_tokens_token_hash_key").on(table.tokenHash),
    (0, pg_core_1.index)("booking_guest_access_tokens_booking_idx").on(table.bookingId),
]);
exports.BOOKING_EVENT_TYPES = [
    "BOOKING_CREATED",
    "HOST_ACCEPTED",
    "HOST_REJECTED",
    "REQUEST_EXPIRED",
    "GUEST_CANCELLED",
    "HOST_CANCELLED",
    "HOLD_CREATED",
    "HOLD_EXPIRED",
    "HOLD_RELEASED",
    "HOLD_CONVERTED",
    "PAYMENT_STARTED",
    "PAYMENT_SUCCEEDED",
    "PAYMENT_FAILED",
    "BOOKING_CONFIRMED",
    "REFUND_REQUESTED",
    "REFUND_SUCCEEDED",
    "STAY_INSTRUCTIONS_SENT",
    "SENSITIVE_ACCESS_REVEALED",
    "CHECKOUT_REMINDER_SENT",
    "BOOKING_COMPLETED",
    "MESSAGE_SENT",
    "SETTLEMENT_CREATED",
    "SETTLEMENT_RELEASED",
    "SETTLEMENT_CANCELLED",
    "HOST_TRANSFER_SUCCEEDED",
    "HOST_TRANSFER_REVERSED",
];
exports.ACTOR_TYPES = ["GUEST", "HOST", "SYSTEM"];
exports.bookingEvents = (0, pg_core_1.pgTable)("booking_events", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "cascade" }),
    type: (0, pg_core_1.text)("type").notNull(),
    actorType: (0, pg_core_1.text)("actor_type").notNull(),
    actorId: (0, pg_core_1.uuid)("actor_id"),
    metadataJson: (0, pg_core_1.text)("metadata_json"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.index)("booking_events_booking_idx").on(table.bookingId),
    (0, pg_core_1.index)("booking_events_created_at_idx").on(table.createdAt),
    (0, pg_core_1.check)("booking_events_actor_check", (0, drizzle_orm_1.sql) `${table.actorType} IN ('GUEST','HOST','SYSTEM')`),
]);
exports.NOTIFICATION_TYPES = [
    "BOOKING_REQUEST_CREATED",
    "BOOKING_REQUEST_ACCEPTED",
    "BOOKING_REQUEST_REJECTED",
    "BOOKING_REQUEST_EXPIRED",
    "BOOKING_REQUEST_REMINDER",
    "BOOKING_CONFIRMED",
    "BOOKING_CANCELLED_BY_GUEST",
    "BOOKING_CANCELLED_BY_HOST",
    "STAY_INSTRUCTIONS_READY",
    "SENSITIVE_ACCESS_READY",
    "STAY_CHECKOUT_REMINDER",
    "BOOKING_MESSAGE_TO_HOST",
    "BOOKING_MESSAGE_TO_GUEST",
];
exports.NOTIFICATION_STATUSES = ["PENDING", "SENT", "FAILED"];
exports.notificationDeliveries = (0, pg_core_1.pgTable)("notification_deliveries", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "cascade" }),
    type: (0, pg_core_1.text)("type").notNull(),
    recipientType: (0, pg_core_1.text)("recipient_type").notNull(),
    recipientAddress: (0, pg_core_1.text)("recipient_address").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    dedupKey: (0, pg_core_1.text)("dedup_key").notNull(),
    attemptCount: (0, pg_core_1.integer)("attempt_count").notNull().default(0),
    lastErrorCode: (0, pg_core_1.text)("last_error_code"),
    sentAt: (0, pg_core_1.timestamp)("sent_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("notification_deliveries_dedup_key").on(table.dedupKey),
    (0, pg_core_1.index)("notification_deliveries_booking_idx").on(table.bookingId),
    (0, pg_core_1.index)("notification_deliveries_status_idx").on(table.status),
    (0, pg_core_1.check)("notification_deliveries_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','SENT','FAILED')`),
    (0, pg_core_1.check)("notification_deliveries_recipient_check", (0, drizzle_orm_1.sql) `${table.recipientType} IN ('GUEST','HOST')`),
    (0, pg_core_1.check)("notification_deliveries_attempts_check", (0, drizzle_orm_1.sql) `${table.attemptCount} >= 0`),
]);
exports.OUTBOX_STATUSES = ["PENDING", "PROCESSING", "PROCESSED", "FAILED"];
exports.outboxEvents = (0, pg_core_1.pgTable)("outbox_events", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    type: (0, pg_core_1.text)("type").notNull(),
    aggregateType: (0, pg_core_1.text)("aggregate_type").notNull(),
    aggregateId: (0, pg_core_1.uuid)("aggregate_id").notNull(),
    payloadJson: (0, pg_core_1.text)("payload_json").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    attemptCount: (0, pg_core_1.integer)("attempt_count").notNull().default(0),
    lastError: (0, pg_core_1.text)("last_error"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: (0, pg_core_1.timestamp)("processed_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)("outbox_events_status_created_idx").on(table.status, table.createdAt),
    (0, pg_core_1.index)("outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId),
    (0, pg_core_1.check)("outbox_events_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','PROCESSING','PROCESSED','FAILED')`),
]);
exports.PAYMENT_PROVIDERS = ["STRIPE"];
exports.PAYMENT_STATUSES = [
    "CREATED",
    "PROCESSING",
    "REQUIRES_ACTION",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "REFUND_PENDING",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
];
exports.OPEN_PAYMENT_STATUSES = [
    "CREATED",
    "PROCESSING",
    "REQUIRES_ACTION",
];
exports.payments = (0, pg_core_1.pgTable)("payments", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "restrict" }),
    provider: (0, pg_core_1.text)("provider").notNull().default("STRIPE"),
    providerPaymentId: (0, pg_core_1.text)("provider_payment_id"),
    status: (0, pg_core_1.text)("status").notNull().default("CREATED"),
    amountMinor: (0, pg_core_1.integer)("amount_minor").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    platformFeeAmountMinor: (0, pg_core_1.integer)("platform_fee_amount_minor").notNull().default(0),
    failureCode: (0, pg_core_1.text)("failure_code"),
    failureMessage: (0, pg_core_1.text)("failure_message"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: (0, pg_core_1.timestamp)("succeeded_at", { withTimezone: true }),
    failedAt: (0, pg_core_1.timestamp)("failed_at", { withTimezone: true }),
    cancelledAt: (0, pg_core_1.timestamp)("cancelled_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)("payments_booking_idx").on(table.bookingId),
    (0, pg_core_1.uniqueIndex)("payments_provider_payment_id_key").on(table.providerPaymentId),
    (0, pg_core_1.index)("payments_status_idx").on(table.status),
    (0, pg_core_1.uniqueIndex)("payments_booking_open_key")
        .on(table.bookingId)
        .where((0, drizzle_orm_1.sql) `${table.status} IN ('CREATED','PROCESSING','REQUIRES_ACTION')`),
    (0, pg_core_1.check)("payments_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('STRIPE')`),
    (0, pg_core_1.check)("payments_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('CREATED','PROCESSING','REQUIRES_ACTION','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED')`),
    (0, pg_core_1.check)("payments_amount_check", (0, drizzle_orm_1.sql) `${table.amountMinor} > 0`),
    (0, pg_core_1.check)("payments_fee_check", (0, drizzle_orm_1.sql) `${table.platformFeeAmountMinor} >= 0`),
    (0, pg_core_1.check)("payments_currency_check", (0, drizzle_orm_1.sql) `${table.currency} IN ('PLN','EUR','USD','GBP')`),
]);
exports.REFUND_TYPES = ["FULL", "PARTIAL"];
exports.REFUND_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"];
exports.REFUND_REASONS = [
    "PAYMENT_AFTER_HOLD_EXPIRY",
    "AMOUNT_MISMATCH",
    "HOST_CANCELLED",
    "GUEST_CANCELLED",
];
exports.refunds = (0, pg_core_1.pgTable)("refunds", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    paymentId: (0, pg_core_1.uuid)("payment_id")
        .notNull()
        .references(() => exports.payments.id, { onDelete: "restrict" }),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "restrict" }),
    providerRefundId: (0, pg_core_1.text)("provider_refund_id"),
    type: (0, pg_core_1.text)("type").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    amountMinor: (0, pg_core_1.integer)("amount_minor").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    reason: (0, pg_core_1.text)("reason").notNull(),
    failureCode: (0, pg_core_1.text)("failure_code"),
    failureMessage: (0, pg_core_1.text)("failure_message"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: (0, pg_core_1.timestamp)("succeeded_at", { withTimezone: true }),
    failedAt: (0, pg_core_1.timestamp)("failed_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)("refunds_booking_idx").on(table.bookingId),
    (0, pg_core_1.uniqueIndex)("refunds_provider_refund_id_key").on(table.providerRefundId),
    (0, pg_core_1.index)("refunds_status_idx").on(table.status),
    (0, pg_core_1.uniqueIndex)("refunds_payment_reason_key").on(table.paymentId, table.reason),
    (0, pg_core_1.check)("refunds_type_check", (0, drizzle_orm_1.sql) `${table.type} IN ('FULL','PARTIAL')`),
    (0, pg_core_1.check)("refunds_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')`),
    (0, pg_core_1.check)("refunds_reason_check", (0, drizzle_orm_1.sql) `${table.reason} IN ('PAYMENT_AFTER_HOLD_EXPIRY','AMOUNT_MISMATCH','HOST_CANCELLED','GUEST_CANCELLED')`),
    (0, pg_core_1.check)("refunds_amount_check", (0, drizzle_orm_1.sql) `${table.amountMinor} > 0`),
]);
exports.paymentProviderEvents = (0, pg_core_1.pgTable)("payment_provider_events", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    provider: (0, pg_core_1.text)("provider").notNull().default("STRIPE"),
    providerEventId: (0, pg_core_1.text)("provider_event_id").notNull(),
    eventType: (0, pg_core_1.text)("event_type").notNull(),
    processedAt: (0, pg_core_1.timestamp)("processed_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("payment_provider_events_provider_event_key").on(table.provider, table.providerEventId),
    (0, pg_core_1.index)("payment_provider_events_processed_idx").on(table.processedAt),
    (0, pg_core_1.check)("payment_provider_events_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('STRIPE')`),
]);
exports.HOST_PAYMENT_READINESS = [
    "NOT_STARTED",
    "IN_PROGRESS",
    "READY",
    "RESTRICTED",
];
exports.hostPaymentAccounts = (0, pg_core_1.pgTable)("host_payment_accounts", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider").notNull().default("STRIPE"),
    providerAccountId: (0, pg_core_1.text)("provider_account_id").notNull(),
    onboardingStatus: (0, pg_core_1.text)("onboarding_status").notNull().default("NOT_STARTED"),
    chargesEnabled: (0, pg_core_1.boolean)("charges_enabled").notNull().default(false),
    payoutsEnabled: (0, pg_core_1.boolean)("payouts_enabled").notNull().default(false),
    detailsSubmitted: (0, pg_core_1.boolean)("details_submitted").notNull().default(false),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("host_payment_accounts_host_provider_key").on(table.hostId, table.provider),
    (0, pg_core_1.uniqueIndex)("host_payment_accounts_provider_account_key").on(table.providerAccountId),
    (0, pg_core_1.check)("host_payment_accounts_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('STRIPE')`),
    (0, pg_core_1.check)("host_payment_accounts_status_check", (0, drizzle_orm_1.sql) `${table.onboardingStatus} IN ('NOT_STARTED','IN_PROGRESS','READY','RESTRICTED')`),
]);
exports.propertyStayInformation = (0, pg_core_1.pgTable)("property_stay_information", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    checkInTime: (0, pg_core_1.text)("check_in_time").notNull().default("15:00"),
    checkOutTime: (0, pg_core_1.text)("check_out_time").notNull().default("11:00"),
    arrivalInstructions: (0, pg_core_1.text)("arrival_instructions"),
    parkingInstructions: (0, pg_core_1.text)("parking_instructions"),
    wifiName: (0, pg_core_1.text)("wifi_name"),
    wifiPassword: (0, pg_core_1.text)("wifi_password"),
    houseRules: (0, pg_core_1.text)("house_rules"),
    departureInstructions: (0, pg_core_1.text)("departure_instructions"),
    emergencyContact: (0, pg_core_1.text)("emergency_contact"),
    instructionsSendOffsetHours: (0, pg_core_1.integer)("instructions_send_offset_hours")
        .notNull()
        .default(24),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("property_stay_information_property_key").on(table.propertyId),
    (0, pg_core_1.check)("property_stay_information_check_in_time_check", (0, drizzle_orm_1.sql) `${table.checkInTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    (0, pg_core_1.check)("property_stay_information_check_out_time_check", (0, drizzle_orm_1.sql) `${table.checkOutTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    (0, pg_core_1.check)("property_stay_information_offset_check", (0, drizzle_orm_1.sql) `${table.instructionsSendOffsetHours} BETWEEN 1 AND 336`),
]);
exports.propertySensitiveAccess = (0, pg_core_1.pgTable)("property_sensitive_access", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    accessInstructionsEncrypted: (0, pg_core_1.text)("access_instructions_encrypted"),
    accessCodeEncrypted: (0, pg_core_1.text)("access_code_encrypted"),
    keyboxLocationEncrypted: (0, pg_core_1.text)("keybox_location_encrypted"),
    revealOffsetHours: (0, pg_core_1.integer)("reveal_offset_hours").notNull().default(6),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("property_sensitive_access_property_key").on(table.propertyId),
    (0, pg_core_1.check)("property_sensitive_access_offset_check", (0, drizzle_orm_1.sql) `${table.revealOffsetHours} BETWEEN 1 AND 336`),
]);
exports.bookingConversations = (0, pg_core_1.pgTable)("booking_conversations", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "cascade" }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [(0, pg_core_1.uniqueIndex)("booking_conversations_booking_key").on(table.bookingId)]);
exports.MESSAGE_SENDER_TYPES = ["GUEST", "HOST", "SYSTEM"];
exports.bookingMessages = (0, pg_core_1.pgTable)("booking_messages", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    conversationId: (0, pg_core_1.uuid)("conversation_id")
        .notNull()
        .references(() => exports.bookingConversations.id, { onDelete: "cascade" }),
    senderUserId: (0, pg_core_1.uuid)("sender_user_id").references(() => exports.users.id, {
        onDelete: "set null",
    }),
    senderType: (0, pg_core_1.text)("sender_type").notNull(),
    body: (0, pg_core_1.text)("body").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.index)("booking_messages_conversation_idx").on(table.conversationId),
    (0, pg_core_1.index)("booking_messages_created_at_idx").on(table.createdAt),
    (0, pg_core_1.index)("booking_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    (0, pg_core_1.check)("booking_messages_sender_check", (0, drizzle_orm_1.sql) `${table.senderType} IN ('GUEST','HOST','SYSTEM')`),
    (0, pg_core_1.check)("booking_messages_body_check", (0, drizzle_orm_1.sql) `length(btrim(${table.body})) BETWEEN 1 AND 4000`),
]);
exports.SETTLEMENT_STATUSES = [
    "PENDING",
    "AVAILABLE",
    "TRANSFER_PENDING",
    "TRANSFERRED",
    "CANCELLED",
    "FAILED",
    "REVERSAL_PENDING",
    "REVERSED",
];
exports.bookingSettlements = (0, pg_core_1.pgTable)("booking_settlements", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    bookingId: (0, pg_core_1.uuid)("booking_id")
        .notNull()
        .references(() => exports.bookings.id, { onDelete: "restrict" }),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "restrict" }),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "restrict" }),
    currency: (0, pg_core_1.text)("currency").notNull(),
    grossAmountMinor: (0, pg_core_1.integer)("gross_amount_minor").notNull(),
    platformFeeMinor: (0, pg_core_1.integer)("platform_fee_minor").notNull(),
    hostAmountMinor: (0, pg_core_1.integer)("host_amount_minor").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    releaseAt: (0, pg_core_1.timestamp)("release_at", { withTimezone: true }).notNull(),
    provider: (0, pg_core_1.text)("provider").notNull().default("STRIPE"),
    providerTransferId: (0, pg_core_1.text)("provider_transfer_id"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    availableAt: (0, pg_core_1.timestamp)("available_at", { withTimezone: true }),
    transferredAt: (0, pg_core_1.timestamp)("transferred_at", { withTimezone: true }),
    cancelledAt: (0, pg_core_1.timestamp)("cancelled_at", { withTimezone: true }),
    failedAt: (0, pg_core_1.timestamp)("failed_at", { withTimezone: true }),
    failureCode: (0, pg_core_1.text)("failure_code"),
    failureMessage: (0, pg_core_1.text)("failure_message"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("booking_settlements_booking_key").on(table.bookingId),
    (0, pg_core_1.index)("booking_settlements_host_idx").on(table.hostId),
    (0, pg_core_1.index)("booking_settlements_status_idx").on(table.status),
    (0, pg_core_1.index)("booking_settlements_status_release_idx").on(table.status, table.releaseAt),
    (0, pg_core_1.check)("booking_settlements_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','AVAILABLE','TRANSFER_PENDING','TRANSFERRED','CANCELLED','FAILED','REVERSAL_PENDING','REVERSED')`),
    (0, pg_core_1.check)("booking_settlements_gross_check", (0, drizzle_orm_1.sql) `${table.grossAmountMinor} >= 0`),
    (0, pg_core_1.check)("booking_settlements_fee_check", (0, drizzle_orm_1.sql) `${table.platformFeeMinor} >= 0`),
    (0, pg_core_1.check)("booking_settlements_host_amount_check", (0, drizzle_orm_1.sql) `${table.hostAmountMinor} >= 0`),
    (0, pg_core_1.check)("booking_settlements_split_check", (0, drizzle_orm_1.sql) `${table.hostAmountMinor} + ${table.platformFeeMinor} = ${table.grossAmountMinor}`),
    (0, pg_core_1.check)("booking_settlements_currency_check", (0, drizzle_orm_1.sql) `${table.currency} IN ('PLN','EUR','USD','GBP')`),
]);
exports.TRANSFER_STATUSES = [
    "PENDING",
    "PROCESSING",
    "SUCCEEDED",
    "FAILED",
    "REVERSAL_PENDING",
    "REVERSED",
];
exports.hostTransfers = (0, pg_core_1.pgTable)("host_transfers", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    settlementId: (0, pg_core_1.uuid)("settlement_id")
        .notNull()
        .references(() => exports.bookingSettlements.id, { onDelete: "restrict" }),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "restrict" }),
    provider: (0, pg_core_1.text)("provider").notNull().default("STRIPE"),
    providerTransferId: (0, pg_core_1.text)("provider_transfer_id"),
    amountMinor: (0, pg_core_1.integer)("amount_minor").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: (0, pg_core_1.timestamp)("succeeded_at", { withTimezone: true }),
    failedAt: (0, pg_core_1.timestamp)("failed_at", { withTimezone: true }),
    reversedAt: (0, pg_core_1.timestamp)("reversed_at", { withTimezone: true }),
    failureCode: (0, pg_core_1.text)("failure_code"),
    failureMessage: (0, pg_core_1.text)("failure_message"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("host_transfers_settlement_live_key")
        .on(table.settlementId)
        .where((0, drizzle_orm_1.sql) `${table.status} <> 'FAILED'`),
    (0, pg_core_1.index)("host_transfers_settlement_idx").on(table.settlementId),
    (0, pg_core_1.index)("host_transfers_host_idx").on(table.hostId),
    (0, pg_core_1.index)("host_transfers_status_idx").on(table.status),
    (0, pg_core_1.uniqueIndex)("host_transfers_provider_transfer_key").on(table.providerTransferId),
    (0, pg_core_1.check)("host_transfers_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','REVERSAL_PENDING','REVERSED')`),
    (0, pg_core_1.check)("host_transfers_amount_check", (0, drizzle_orm_1.sql) `${table.amountMinor} > 0`),
]);
exports.REVERSAL_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"];
exports.REVERSAL_REASONS = ["REFUNDED_AFTER_TRANSFER"];
exports.hostTransferReversals = (0, pg_core_1.pgTable)("host_transfer_reversals", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    transferId: (0, pg_core_1.uuid)("transfer_id")
        .notNull()
        .references(() => exports.hostTransfers.id, { onDelete: "restrict" }),
    settlementId: (0, pg_core_1.uuid)("settlement_id")
        .notNull()
        .references(() => exports.bookingSettlements.id, { onDelete: "restrict" }),
    providerReversalId: (0, pg_core_1.text)("provider_reversal_id"),
    amountMinor: (0, pg_core_1.integer)("amount_minor").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    reason: (0, pg_core_1.text)("reason").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: (0, pg_core_1.timestamp)("succeeded_at", { withTimezone: true }),
    failedAt: (0, pg_core_1.timestamp)("failed_at", { withTimezone: true }),
    failureCode: (0, pg_core_1.text)("failure_code"),
    failureMessage: (0, pg_core_1.text)("failure_message"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("host_transfer_reversals_transfer_reason_key").on(table.transferId, table.reason),
    (0, pg_core_1.index)("host_transfer_reversals_settlement_idx").on(table.settlementId),
    (0, pg_core_1.uniqueIndex)("host_transfer_reversals_provider_key").on(table.providerReversalId),
    (0, pg_core_1.check)("host_transfer_reversals_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')`),
    (0, pg_core_1.check)("host_transfer_reversals_reason_check", (0, drizzle_orm_1.sql) `${table.reason} IN ('REFUNDED_AFTER_TRANSFER')`),
    (0, pg_core_1.check)("host_transfer_reversals_amount_check", (0, drizzle_orm_1.sql) `${table.amountMinor} > 0`),
]);
exports.PAYOUT_STATUSES = ["PENDING", "IN_TRANSIT", "PAID", "FAILED", "CANCELLED"];
exports.hostPayouts = (0, pg_core_1.pgTable)("host_payouts", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider").notNull().default("STRIPE"),
    providerPayoutId: (0, pg_core_1.text)("provider_payout_id").notNull(),
    amountMinor: (0, pg_core_1.integer)("amount_minor").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    arrivalAt: (0, pg_core_1.timestamp)("arrival_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: (0, pg_core_1.timestamp)("paid_at", { withTimezone: true }),
    failedAt: (0, pg_core_1.timestamp)("failed_at", { withTimezone: true }),
    failureCode: (0, pg_core_1.text)("failure_code"),
    failureMessage: (0, pg_core_1.text)("failure_message"),
}, (table) => [
    (0, pg_core_1.index)("host_payouts_host_idx").on(table.hostId),
    (0, pg_core_1.uniqueIndex)("host_payouts_provider_payout_key").on(table.providerPayoutId),
    (0, pg_core_1.index)("host_payouts_status_idx").on(table.status),
    (0, pg_core_1.check)("host_payouts_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','IN_TRANSIT','PAID','FAILED','CANCELLED')`),
    (0, pg_core_1.check)("host_payouts_amount_check", (0, drizzle_orm_1.sql) `${table.amountMinor} >= 0`),
]);
exports.ADMIN_ACTION_TYPES = [
    "RETRY_NOTIFICATION",
    "RETRY_REFUND",
    "RETRY_TRANSFER",
    "RETRY_JOB",
    "ICAL_RESYNC",
    "REFRESH_CONNECT_STATUS",
    "RECONCILE",
    "RETRY_INTEGRATION_SYNC",
    "RECONCILE_INTEGRATION",
    "DISABLE_INTEGRATION",
    "RETRY_OUTBOUND_RESERVATION",
];
exports.ADMIN_ACTION_TARGETS = [
    "BOOKING",
    "NOTIFICATION",
    "REFUND",
    "SETTLEMENT",
    "HOST",
    "EXTERNAL_CALENDAR",
    "JOB",
    "PLATFORM",
    "CONNECTION",
];
exports.ADMIN_ACTION_STATUSES = ["STARTED", "SUCCEEDED", "FAILED"];
exports.adminActions = (0, pg_core_1.pgTable)("admin_actions", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    adminUserId: (0, pg_core_1.uuid)("admin_user_id")
        .notNull()
        .references(() => exports.users.id, { onDelete: "restrict" }),
    actionType: (0, pg_core_1.text)("action_type").notNull(),
    targetType: (0, pg_core_1.text)("target_type").notNull(),
    targetId: (0, pg_core_1.text)("target_id").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("STARTED"),
    metadataJson: (0, pg_core_1.text)("metadata_json"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)("admin_actions_created_at_idx").on(table.createdAt),
    (0, pg_core_1.index)("admin_actions_admin_idx").on(table.adminUserId),
    (0, pg_core_1.index)("admin_actions_target_idx").on(table.targetType, table.targetId),
    (0, pg_core_1.check)("admin_actions_type_check", (0, drizzle_orm_1.sql) `${table.actionType} IN ('RETRY_NOTIFICATION','RETRY_REFUND','RETRY_TRANSFER','RETRY_JOB','ICAL_RESYNC','REFRESH_CONNECT_STATUS','RECONCILE','RETRY_INTEGRATION_SYNC','RECONCILE_INTEGRATION','DISABLE_INTEGRATION','RETRY_OUTBOUND_RESERVATION')`),
    (0, pg_core_1.check)("admin_actions_target_check", (0, drizzle_orm_1.sql) `${table.targetType} IN ('BOOKING','NOTIFICATION','REFUND','SETTLEMENT','HOST','EXTERNAL_CALENDAR','JOB','PLATFORM','CONNECTION')`),
    (0, pg_core_1.check)("admin_actions_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('STARTED','SUCCEEDED','FAILED')`),
]);
exports.EXTERNAL_PROVIDERS = ["HOSTAWAY", "CHANNEX"];
exports.CONNECTION_STATUSES = [
    "PENDING",
    "CONNECTED",
    "DEGRADED",
    "DISCONNECTED",
    "ACTION_REQUIRED",
];
exports.CONNECTION_STATUS_REASONS = [
    "PARTNER_ACCESS_REQUIRED",
    "CREDENTIALS_MISSING",
    "CREDENTIALS_REJECTED",
    "PROVIDER_UNAVAILABLE",
    "DISABLED_BY_HOST",
    "DISABLED_BY_ADMIN",
];
exports.externalInventoryConnections = (0, pg_core_1.pgTable)("external_inventory_connections", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    hostId: (0, pg_core_1.uuid)("host_id")
        .notNull()
        .references(() => exports.hosts.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("PENDING"),
    statusReason: (0, pg_core_1.text)("status_reason"),
    externalAccountId: (0, pg_core_1.text)("external_account_id"),
    credentialsEncrypted: (0, pg_core_1.text)("credentials_encrypted"),
    configurationJson: (0, pg_core_1.text)("configuration_json"),
    lastSuccessfulSyncAt: (0, pg_core_1.timestamp)("last_successful_sync_at", { withTimezone: true }),
    lastFailedSyncAt: (0, pg_core_1.timestamp)("last_failed_sync_at", { withTimezone: true }),
    lastErrorCode: (0, pg_core_1.text)("last_error_code"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
    disabledAt: (0, pg_core_1.timestamp)("disabled_at", { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("external_inventory_connections_host_provider_key").on(table.hostId, table.provider),
    (0, pg_core_1.index)("external_inventory_connections_status_idx").on(table.status),
    (0, pg_core_1.check)("external_inventory_connections_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('HOSTAWAY','CHANNEX')`),
    (0, pg_core_1.check)("external_inventory_connections_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','CONNECTED','DEGRADED','DISCONNECTED','ACTION_REQUIRED')`),
    (0, pg_core_1.check)("external_inventory_connections_reason_check", (0, drizzle_orm_1.sql) `${table.statusReason} IS NULL OR ${table.statusReason} IN ('PARTNER_ACCESS_REQUIRED','CREDENTIALS_MISSING','CREDENTIALS_REJECTED','PROVIDER_UNAVAILABLE','DISABLED_BY_HOST','DISABLED_BY_ADMIN')`),
]);
exports.MAPPING_STATUSES = ["ACTIVE", "PAUSED"];
exports.externalPropertyMappings = (0, pg_core_1.pgTable)("external_property_mappings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    connectionId: (0, pg_core_1.uuid)("connection_id")
        .notNull()
        .references(() => exports.externalInventoryConnections.id, { onDelete: "cascade" }),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    externalPropertyId: (0, pg_core_1.text)("external_property_id").notNull(),
    externalPropertyName: (0, pg_core_1.text)("external_property_name"),
    status: (0, pg_core_1.text)("status").notNull().default("ACTIVE"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("external_property_mappings_connection_property_key").on(table.connectionId, table.propertyId),
    (0, pg_core_1.uniqueIndex)("external_property_mappings_connection_external_key").on(table.connectionId, table.externalPropertyId),
    (0, pg_core_1.index)("external_property_mappings_property_idx").on(table.propertyId),
    (0, pg_core_1.check)("external_property_mappings_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('ACTIVE','PAUSED')`),
]);
exports.RESERVATION_DIRECTIONS = ["INBOUND", "OUTBOUND"];
exports.RESERVATION_MAPPING_STATUSES = [
    "PENDING",
    "ACTIVE",
    "CANCELLED",
    "FAILED",
];
exports.externalReservationMappings = (0, pg_core_1.pgTable)("external_reservation_mappings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    connectionId: (0, pg_core_1.uuid)("connection_id")
        .notNull()
        .references(() => exports.externalInventoryConnections.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider").notNull(),
    externalReservationId: (0, pg_core_1.text)("external_reservation_id").notNull(),
    bookingId: (0, pg_core_1.uuid)("booking_id").references(() => exports.bookings.id, { onDelete: "set null" }),
    propertyId: (0, pg_core_1.uuid)("property_id")
        .notNull()
        .references(() => exports.properties.id, { onDelete: "cascade" }),
    direction: (0, pg_core_1.text)("direction").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("ACTIVE"),
    checkIn: (0, pg_core_1.date)("check_in"),
    checkOut: (0, pg_core_1.date)("check_out"),
    lastErrorCode: (0, pg_core_1.text)("last_error_code"),
    attemptCount: (0, pg_core_1.integer)("attempt_count").notNull().default(0),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("external_reservation_mappings_connection_external_key").on(table.connectionId, table.externalReservationId),
    (0, pg_core_1.uniqueIndex)("external_reservation_mappings_outbound_booking_key")
        .on(table.connectionId, table.bookingId)
        .where((0, drizzle_orm_1.sql) `${table.direction} = 'OUTBOUND' AND ${table.status} <> 'FAILED'`),
    (0, pg_core_1.index)("external_reservation_mappings_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("external_reservation_mappings_status_idx").on(table.status),
    (0, pg_core_1.index)("external_reservation_mappings_booking_idx").on(table.bookingId),
    (0, pg_core_1.check)("external_reservation_mappings_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('HOSTAWAY','CHANNEX')`),
    (0, pg_core_1.check)("external_reservation_mappings_direction_check", (0, drizzle_orm_1.sql) `${table.direction} IN ('INBOUND','OUTBOUND')`),
    (0, pg_core_1.check)("external_reservation_mappings_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('PENDING','ACTIVE','CANCELLED','FAILED')`),
    (0, pg_core_1.check)("external_reservation_mappings_stay_check", (0, drizzle_orm_1.sql) `${table.checkIn} IS NULL OR ${table.checkOut} IS NULL OR ${table.checkOut} > ${table.checkIn}`),
    (0, pg_core_1.check)("external_reservation_mappings_attempts_check", (0, drizzle_orm_1.sql) `${table.attemptCount} >= 0`),
]);
exports.externalProviderEvents = (0, pg_core_1.pgTable)("external_provider_events", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    provider: (0, pg_core_1.text)("provider").notNull(),
    connectionId: (0, pg_core_1.uuid)("connection_id").references(() => exports.externalInventoryConnections.id, {
        onDelete: "cascade",
    }),
    providerEventId: (0, pg_core_1.text)("provider_event_id").notNull(),
    eventType: (0, pg_core_1.text)("event_type").notNull(),
    payloadHash: (0, pg_core_1.text)("payload_hash"),
    processedAt: (0, pg_core_1.timestamp)("processed_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("external_provider_events_provider_event_key").on(table.provider, table.providerEventId),
    (0, pg_core_1.index)("external_provider_events_processed_idx").on(table.processedAt),
    (0, pg_core_1.index)("external_provider_events_connection_idx").on(table.connectionId),
    (0, pg_core_1.check)("external_provider_events_provider_check", (0, drizzle_orm_1.sql) `${table.provider} IN ('HOSTAWAY','CHANNEX')`),
]);
exports.SYNC_TYPES = [
    "PROPERTY_DISCOVERY",
    "INBOUND_RESERVATIONS",
    "OUTBOUND_PUSH",
    "OUTBOUND_CANCEL",
    "RECONCILIATION",
    "WEBHOOK",
    "CONNECTION_CHECK",
];
exports.SYNC_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED"];
exports.externalSyncAttempts = (0, pg_core_1.pgTable)("external_sync_attempts", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    connectionId: (0, pg_core_1.uuid)("connection_id")
        .notNull()
        .references(() => exports.externalInventoryConnections.id, { onDelete: "cascade" }),
    syncType: (0, pg_core_1.text)("sync_type").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("RUNNING"),
    startedAt: (0, pg_core_1.timestamp)("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { withTimezone: true }),
    itemsProcessed: (0, pg_core_1.integer)("items_processed").notNull().default(0),
    itemsFailed: (0, pg_core_1.integer)("items_failed").notNull().default(0),
    errorCode: (0, pg_core_1.text)("error_code"),
}, (table) => [
    (0, pg_core_1.index)("external_sync_attempts_connection_started_idx").on(table.connectionId, table.startedAt),
    (0, pg_core_1.index)("external_sync_attempts_status_idx").on(table.status),
    (0, pg_core_1.check)("external_sync_attempts_type_check", (0, drizzle_orm_1.sql) `${table.syncType} IN ('PROPERTY_DISCOVERY','INBOUND_RESERVATIONS','OUTBOUND_PUSH','OUTBOUND_CANCEL','RECONCILIATION','WEBHOOK','CONNECTION_CHECK')`),
    (0, pg_core_1.check)("external_sync_attempts_status_check", (0, drizzle_orm_1.sql) `${table.status} IN ('RUNNING','SUCCEEDED','FAILED')`),
    (0, pg_core_1.check)("external_sync_attempts_processed_check", (0, drizzle_orm_1.sql) `${table.itemsProcessed} >= 0`),
    (0, pg_core_1.check)("external_sync_attempts_failed_check", (0, drizzle_orm_1.sql) `${table.itemsFailed} >= 0`),
]);
//# sourceMappingURL=schema.js.map