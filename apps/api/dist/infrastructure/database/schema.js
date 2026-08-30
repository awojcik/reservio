"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outboxEvents = exports.OUTBOX_STATUSES = exports.notificationDeliveries = exports.NOTIFICATION_STATUSES = exports.NOTIFICATION_TYPES = exports.bookingEvents = exports.ACTOR_TYPES = exports.BOOKING_EVENT_TYPES = exports.bookingGuestAccessTokens = exports.BOOKING_STATUS_REASONS = exports.calendarExportTokens = exports.availabilityBlocks = exports.idempotencyKeys = exports.bookingHolds = exports.bookings = exports.BOOKING_HOLD_STATUSES = exports.BOOKING_STATUSES = exports.BOOKING_MODES = exports.externalCalendars = exports.EXTERNAL_CALENDAR_STATUSES = exports.EXTERNAL_CALENDAR_PROVIDERS = exports.AVAILABILITY_SOURCE_TYPES = exports.propertyAmenities = exports.amenities = exports.propertyImages = exports.properties = exports.hosts = exports.userSessions = exports.users = exports.PROPERTY_TYPES = exports.PROPERTY_STATUSES = void 0;
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
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    email: (0, pg_core_1.text)("email").notNull(),
    passwordHash: (0, pg_core_1.text)("password_hash").notNull(),
    firstName: (0, pg_core_1.text)("first_name"),
    lastName: (0, pg_core_1.text)("last_name"),
    phone: (0, pg_core_1.text)("phone"),
    preferredLocale: (0, pg_core_1.text)("preferred_locale"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("users_email_key").on(table.email),
    (0, pg_core_1.check)("users_email_lowercase_check", (0, drizzle_orm_1.sql) `${table.email} = lower(${table.email})`),
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
}, (table) => [
    (0, pg_core_1.uniqueIndex)("bookings_public_reference_key").on(table.publicReference),
    (0, pg_core_1.index)("bookings_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("bookings_host_idx").on(table.hostId),
    (0, pg_core_1.index)("bookings_status_idx").on(table.status),
    (0, pg_core_1.index)("bookings_created_at_idx").on(table.createdAt),
    (0, pg_core_1.index)("bookings_host_response_deadline_idx").on(table.hostResponseDeadlineAt),
    (0, pg_core_1.index)("bookings_guest_user_idx").on(table.guestUserId),
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
    note: (0, pg_core_1.text)("note"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    (0, pg_core_1.index)("availability_blocks_property_idx").on(table.propertyId),
    (0, pg_core_1.index)("availability_blocks_external_calendar_idx").on(table.externalCalendarId),
    (0, pg_core_1.index)("availability_blocks_booking_hold_idx").on(table.bookingHoldId),
    (0, pg_core_1.check)("availability_blocks_source_check", (0, drizzle_orm_1.sql) `${table.sourceType} IN ('HOST_BLOCK','EXTERNAL_CALENDAR','BOOKING','BOOKING_HOLD','MAINTENANCE')`),
    (0, pg_core_1.check)("availability_blocks_range_check", (0, drizzle_orm_1.sql) `lower(${table.dateRange}) < upper(${table.dateRange})`),
    (0, pg_core_1.check)("availability_blocks_external_link_check", (0, drizzle_orm_1.sql) `(${table.sourceType} = 'EXTERNAL_CALENDAR') = (${table.externalCalendarId} IS NOT NULL)`),
    (0, pg_core_1.check)("availability_blocks_hold_link_check", (0, drizzle_orm_1.sql) `(${table.sourceType} = 'BOOKING_HOLD') = (${table.bookingHoldId} IS NOT NULL)`),
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
//# sourceMappingURL=schema.js.map