import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * PostgreSQL `daterange`, always half-open `[startDate, endDate)`.
 *
 * Drizzle has no first-class range type, and that is fine: every read selects
 * `lower()`/`upper()` explicitly and every write goes through
 * `daterange(?, ?, '[)')`, so the half-open semantics live in one place instead
 * of being re-derived per query. Modelling availability as ranges — never as a
 * row per day — is a deliberate constraint (milestone 03 §67).
 */
const daterange = customType<{ data: string; driverData: string }>({
  dataType: () => "daterange",
});

/**
 * Canonical domain names from docs/rezervio-domain-language.md.
 *
 * Money is stored as integer minor units plus an ISO-4217 currency — never a
 * float. Geography lives in a `geography(Point, 4326)` column added by the SQL
 * migration, because Drizzle has no first-class PostGIS type; the application
 * keeps latitude/longitude and the database keeps the indexable point.
 */

export const PROPERTY_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "PUBLISHED",
  "SUSPENDED",
  "ARCHIVED",
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PROPERTY_TYPES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * One identity for everyone (domain language §2): a User may act as Guest, as
 * Host, or as both. There is no separate Host login.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stored already trimmed and lower-cased, so the unique index is the real
    // guarantee that one address means one account.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),

    /**
     * Profile, all optional: an account is created in one step and filled in
     * later, or never. Email stays the login identity and is not editable here
     * — changing it needs a verification flow that is out of scope.
     */
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    preferredLocale: text("preferred_locale"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email),
    check("users_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
  ],
);

/**
 * Opaque server-side sessions. Only the SHA-256 hash of the token is stored, so
 * a database leak does not hand out working sessions — the same reasoning as
 * for password hashes.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("user_sessions_token_hash_key").on(table.tokenHash),
    index("user_sessions_user_idx").on(table.userId),
    // Expiry is a range scan when sweeping dead sessions, not an equality probe.
    index("user_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const hosts = pgTable(
  "hosts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Nullable on purpose: a Host row may exist before an account does (seeded
     * or imported catalogues). Such a Host simply has no way to sign in, since
     * Host identity is always resolved Session → User → Host, never from a
     * client-supplied id.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One Host profile per User (domain language §14: User 1 -> 0..1 Host).
  (table) => [uniqueIndex("hosts_user_id_key").on(table.userId)],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "restrict" }),

    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /**
     * Nullable, along with latitude/longitude below: a DRAFT is allowed to be
     * incomplete. Publish validation — not the column definition — is what
     * guarantees a public Listing is whole, and public endpoints only ever
     * serve PUBLISHED rows.
     */
    description: text("description"),

    propertyType: text("property_type").notNull(),
    status: text("status").notNull().default("DRAFT"),
    /**
     * How a Guest may book. Request-to-book is the default because it is the
     * safer starting point for a Host who has not yet decided to hand over
     * the calendar automatically.
     */
    bookingMode: text("booking_mode").notNull().default("REQUEST_TO_BOOK"),

    addressLine1: text("address_line1"),
    postalCode: text("postal_code"),
    city: text("city").notNull().default(""),
    district: text("district").notNull().default(""),
    countryCode: text("country_code").notNull().default("PL"),
    timeZone: text("time_zone").notNull().default("Europe/Warsaw"),

    latitude: real("latitude"),
    longitude: real("longitude"),

    maxGuests: integer("max_guests").notNull().default(1),
    bedrooms: integer("bedrooms").notNull().default(0),
    beds: integer("beds").notNull().default(0),
    bathrooms: integer("bathrooms").notNull().default(0),

    rating: real("rating").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),

    distanceToBeachMeters: integer("distance_to_beach_meters"),

    baseDailyRateAmountMinor: integer("base_daily_rate_amount_minor").notNull().default(0),
    cleaningFeeAmountMinor: integer("cleaning_fee_amount_minor").notNull().default(0),
    marketDailyRateAmountMinor: integer("market_daily_rate_amount_minor"),
    currency: text("currency").notNull().default("PLN"),

    /** Set once, on the first successful publish, so the slug can be frozen. */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("properties_slug_key").on(table.slug),
    index("properties_status_idx").on(table.status),
    index("properties_city_idx").on(table.city),
    index("properties_property_type_idx").on(table.propertyType),
    // The Host dashboard always lists one Host's Property, newest change first.
    index("properties_host_id_idx").on(table.hostId),

    check("properties_status_check", sql`${table.status} IN ('DRAFT','IN_REVIEW','PUBLISHED','SUSPENDED','ARCHIVED')`),
    check("properties_type_check", sql`${table.propertyType} IN ('APARTMENT','HOUSE','VILLA','STUDIO')`),
    check(
      "properties_booking_mode_check",
      sql`${table.bookingMode} IN ('REQUEST_TO_BOOK','INSTANT_BOOK')`,
    ),
    check("properties_max_guests_check", sql`${table.maxGuests} > 0`),
    check("properties_bedrooms_check", sql`${table.bedrooms} >= 0`),
    check("properties_beds_check", sql`${table.beds} >= 0`),
    check("properties_bathrooms_check", sql`${table.bathrooms} >= 0`),
    check("properties_rating_check", sql`${table.rating} >= 0 AND ${table.rating} <= 10`),
    check("properties_review_count_check", sql`${table.reviewCount} >= 0`),
    check("properties_base_rate_check", sql`${table.baseDailyRateAmountMinor} >= 0`),
    check("properties_cleaning_fee_check", sql`${table.cleaningFeeAmountMinor} >= 0`),
    check("properties_currency_check", sql`${table.currency} IN ('PLN','EUR','USD','GBP')`),
    check(
      "properties_latitude_check",
      sql`${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`,
    ),
    check(
      "properties_longitude_check",
      sql`${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`,
    ),
    check(
      "properties_market_rate_check",
      sql`${table.marketDailyRateAmountMinor} IS NULL OR ${table.marketDailyRateAmountMinor} >= 0`,
    ),
    check(
      "properties_beach_distance_check",
      sql`${table.distanceToBeachMeters} IS NULL OR ${table.distanceToBeachMeters} >= 0`,
    ),
  ],
);

export const propertyImages = pgTable(
  "property_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    /**
     * The storage identity of the file, and the source of truth for every
     * storage operation. Null for the seeded catalogue, whose photos are plain
     * remote URLs Rezervio does not own.
     */
    objectKey: text("object_key"),
    url: text("url"),
    altText: text("alt_text"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("property_images_property_position_key").on(table.propertyId, table.position),
    uniqueIndex("property_images_object_key_key").on(table.objectKey),
    check("property_images_position_check", sql`${table.position} >= 0`),
    // A row that names neither a stored object nor a URL could never render.
    check(
      "property_images_source_check",
      sql`${table.objectKey} IS NOT NULL OR ${table.url} IS NOT NULL`,
    ),
  ],
);

export const amenities = pgTable(
  "amenities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("amenities_code_key").on(table.code)],
);

export const propertyAmenities = pgTable(
  "property_amenities",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => amenities.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.propertyId, table.amenityId] }),
    index("property_amenities_amenity_idx").on(table.amenityId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type HostRow = typeof hosts.$inferSelect;
export type PropertyRow = typeof properties.$inferSelect;
export type PropertyInsert = typeof properties.$inferInsert;
export type PropertyImageRow = typeof propertyImages.$inferSelect;

export const AVAILABILITY_SOURCE_TYPES = [
  "HOST_BLOCK",
  "EXTERNAL_CALENDAR",
  // Accepted by the schema so Booking can land without another migration, but
  // no flow writes them yet (milestone 03 §8).
  "BOOKING",
  "BOOKING_HOLD",
  "MAINTENANCE",
] as const;
export type AvailabilitySourceType = (typeof AVAILABILITY_SOURCE_TYPES)[number];

export const EXTERNAL_CALENDAR_PROVIDERS = [
  "BOOKING",
  "AIRBNB",
  "VRBO",
  "PMS",
  "OTHER",
] as const;
export type ExternalCalendarProvider = (typeof EXTERNAL_CALENDAR_PROVIDERS)[number];

export const EXTERNAL_CALENDAR_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type ExternalCalendarStatus = (typeof EXTERNAL_CALENDAR_STATUSES)[number];

/**
 * An iCal feed a Host imports from another platform. The import URL often
 * carries a bearer token in its path, so it is encrypted at rest and never
 * returned to a client in full (milestone 03 §19).
 */
export const externalCalendars = pgTable(
  "external_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(),
    name: text("name").notNull(),
    importUrlEncrypted: text("import_url_encrypted").notNull(),
    status: text("status").notNull().default("ACTIVE"),

    lastSyncStartedAt: timestamp("last_sync_started_at", { withTimezone: true }),
    lastSyncSucceededAt: timestamp("last_sync_succeeded_at", { withTimezone: true }),
    lastSyncFailedAt: timestamp("last_sync_failed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("external_calendars_property_idx").on(table.propertyId),
    // The periodic sweep looks for ACTIVE calendars that are due.
    index("external_calendars_status_idx").on(table.status, table.lastSyncSucceededAt),
    check(
      "external_calendars_provider_check",
      sql`${table.provider} IN ('BOOKING','AIRBNB','VRBO','PMS','OTHER')`,
    ),
    check("external_calendars_status_check", sql`${table.status} IN ('ACTIVE','DISABLED')`),
    check(
      "external_calendars_failures_check",
      sql`${table.consecutiveFailures} >= 0`,
    ),
  ],
);

export const BOOKING_MODES = ["REQUEST_TO_BOOK", "INSTANT_BOOK"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/**
 * Booking lifecycle (domain language §3, milestone 04 §6).
 *
 * CONFIRMED is reachable only through a successful Payment, which is
 * Milestone 05 — nothing in this milestone writes it.
 */
export const BOOKING_STATUSES = [
  "PENDING_HOST_APPROVAL",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_HOLD_STATUSES = ["ACTIVE", "RELEASED", "EXPIRED", "CONVERTED"] as const;
export type BookingHoldStatus = (typeof BOOKING_HOLD_STATUSES)[number];

/**
 * A Guest's reservation of a Property for a Stay.
 *
 * Guest details and the price are **snapshots**: a Guest has no account to
 * read back from, and a Host raising the nightly rate tomorrow must not change
 * what someone already agreed to pay (domain language §6).
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short, human-quotable identifier. Not a secret. */
    publicReference: text("public_reference").notNull(),

    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "restrict" }),

    bookingMode: text("booking_mode").notNull(),
    status: text("status").notNull(),
    /** Why the Booking reached a terminal state, e.g. AVAILABILITY_LOST. */
    statusReason: text("status_reason"),

    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    adults: integer("adults").notNull(),
    children: integer("children").notNull().default(0),

    /**
     * The account this Booking belongs to, when there is one.
     *
     * Nullable on purpose: booking without an account must keep working, and
     * an anonymous Booking is only ever linked through an explicit, verified
     * claim — never by matching an email address (milestone 06 §2, §17).
     */
    guestUserId: uuid("guest_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * Who booked, as given at the time. Kept even once `guestUserId` is set:
     * editing a profile tomorrow must not rewrite what somebody agreed to
     * today (milestone 06 §14, §15).
     */
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    guestPhone: text("guest_phone"),

    propertyTitleSnapshot: text("property_title_snapshot").notNull(),
    /**
     * Enough to render a trip card after the Property is archived or
     * suspended — My Trips must not go blank because a Host delisted
     * (milestone 06 §33, §34).
     */
    propertyCitySnapshot: text("property_city_snapshot"),
    coverImageUrlSnapshot: text("cover_image_url_snapshot"),

    accommodationAmountMinor: integer("accommodation_amount_minor").notNull(),
    cleaningFeeAmountMinor: integer("cleaning_fee_amount_minor").notNull(),
    serviceFeeAmountMinor: integer("service_fee_amount_minor").notNull().default(0),
    taxAmountMinor: integer("tax_amount_minor").notNull().default(0),
    discountAmountMinor: integer("discount_amount_minor").notNull().default(0),
    totalAmountMinor: integer("total_amount_minor").notNull(),
    currency: text("currency").notNull(),

    /**
     * When a Request-to-Book stops being acceptable. The database is the source
     * of truth for this, not a delayed job: a late worker must not let a Host
     * accept a request that logically expired hours ago (milestone 05 §23).
     */
    hostResponseDeadlineAt: timestamp("host_response_deadline_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    hostRespondedAt: timestamp("host_responded_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bookings_public_reference_key").on(table.publicReference),
    index("bookings_property_idx").on(table.propertyId),
    index("bookings_host_idx").on(table.hostId),
    index("bookings_status_idx").on(table.status),
    index("bookings_created_at_idx").on(table.createdAt),
    // The expiry sweep looks for requests past their deadline.
    index("bookings_host_response_deadline_idx").on(table.hostResponseDeadlineAt),
    // My Trips reads by account, never by email (milestone 06 §28).
    index("bookings_guest_user_idx").on(table.guestUserId),

    check(
      "bookings_status_check",
      sql`${table.status} IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED','CANCELLED','EXPIRED','COMPLETED')`,
    ),
    check(
      "bookings_mode_check",
      sql`${table.bookingMode} IN ('REQUEST_TO_BOOK','INSTANT_BOOK')`,
    ),
    // Half-open Stay, enforced by the database rather than only by the service.
    check("bookings_stay_check", sql`${table.checkOut} > ${table.checkIn}`),
    check("bookings_adults_check", sql`${table.adults} >= 1`),
    check("bookings_children_check", sql`${table.children} >= 0`),
    check("bookings_accommodation_check", sql`${table.accommodationAmountMinor} >= 0`),
    check("bookings_cleaning_check", sql`${table.cleaningFeeAmountMinor} >= 0`),
    check("bookings_service_fee_check", sql`${table.serviceFeeAmountMinor} >= 0`),
    check("bookings_tax_check", sql`${table.taxAmountMinor} >= 0`),
    check("bookings_discount_check", sql`${table.discountAmountMinor} >= 0`),
    check("bookings_total_check", sql`${table.totalAmountMinor} >= 0`),
    check("bookings_currency_check", sql`${table.currency} IN ('PLN','EUR','USD','GBP')`),
  ],
);

/**
 * A time-boxed claim on a Property's calendar while a Booking is finalised.
 *
 * The hold is what actually blocks the dates; the Booking on its own does not.
 * One hold per Booking, enforced by a unique index, so a retried command can
 * never produce a second claim.
 */
export const bookingHolds = pgTable(
  "booking_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    dateRange: daterange("date_range").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("booking_holds_booking_id_key").on(table.bookingId),
    index("booking_holds_property_idx").on(table.propertyId),
    index("booking_holds_status_idx").on(table.status),
    // The sweep looks for holds past their expiry.
    index("booking_holds_expires_at_idx").on(table.expiresAt),

    check(
      "booking_holds_status_check",
      sql`${table.status} IN ('ACTIVE','RELEASED','EXPIRED','CONVERTED')`,
    ),
    check(
      "booking_holds_range_check",
      sql`lower(${table.dateRange}) < upper(${table.dateRange})`,
    ),
  ],
);

/**
 * Makes `POST /api/bookings` safe to retry. PostgreSQL is the canonical store:
 * correctness must not depend on Redis, which is only ever a job queue here
 * (milestone 04 §31).
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Namespaces the key, so unrelated endpoints cannot collide. */
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    /** Hash of the request body, so the same key with a different payload is a conflict. */
    requestHash: text("request_hash").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_scope_key").on(table.scope, table.keyHash),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * The single reason a Property can be unavailable. One table for every source,
 * so "is this Property free?" is one query no matter where the block came from
 * (domain language §5, milestone 03 §10).
 */
export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    sourceType: text("source_type").notNull(),
    dateRange: daterange("date_range").notNull(),

    externalCalendarId: uuid("external_calendar_id").references(
      () => externalCalendars.id,
      { onDelete: "cascade" },
    ),
    /** Stable identity of the imported VEVENT, so re-syncs update rather than duplicate. */
    externalEventUid: text("external_event_uid"),

    /**
     * Set for BOOKING_HOLD blocks. Availability joins through this to check the
     * hold is still live: an expired hold must stop blocking immediately, not
     * whenever the cleanup job happens to run (milestone 04 §14).
     */
    bookingHoldId: uuid("booking_hold_id").references(() => bookingHolds.id, {
      onDelete: "cascade",
    }),

    /** Host-private; never exported and never shown publicly. */
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("availability_blocks_property_idx").on(table.propertyId),
    index("availability_blocks_external_calendar_idx").on(table.externalCalendarId),
    index("availability_blocks_booking_hold_idx").on(table.bookingHoldId),

    check(
      "availability_blocks_source_check",
      sql`${table.sourceType} IN ('HOST_BLOCK','EXTERNAL_CALENDAR','BOOKING','BOOKING_HOLD','MAINTENANCE')`,
    ),
    check(
      "availability_blocks_range_check",
      sql`lower(${table.dateRange}) < upper(${table.dateRange})`,
    ),
    // Reads both ways: EXTERNAL_CALENDAR needs a calendar, and nothing else may
    // claim one.
    check(
      "availability_blocks_external_link_check",
      sql`(${table.sourceType} = 'EXTERNAL_CALENDAR') = (${table.externalCalendarId} IS NOT NULL)`,
    ),
    // Same shape as the external link: a hold block needs a hold, and nothing
    // else may claim one.
    check(
      "availability_blocks_hold_link_check",
      sql`(${table.sourceType} = 'BOOKING_HOLD') = (${table.bookingHoldId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Unguessable, revocable URL that lets another system subscribe to this
 * Property's Rezervio blocks. Only the hash is stored, like a session token.
 */
export const calendarExportTokens = pgTable(
  "calendar_export_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("calendar_export_tokens_token_hash_key").on(table.tokenHash),
    index("calendar_export_tokens_property_idx").on(table.propertyId),
  ],
);

export type AvailabilityBlockRow = typeof availabilityBlocks.$inferSelect;
export type ExternalCalendarRow = typeof externalCalendars.$inferSelect;
export type CalendarExportTokenRow = typeof calendarExportTokens.$inferSelect;

export type BookingRow = typeof bookings.$inferSelect;
export type BookingHoldRow = typeof bookingHolds.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;

/**
 * Canonical reasons a Booking left the happy path. A free-text column here
 * would make the Guest-facing wording impossible to keep consistent
 * (milestone 05 §36).
 */
export const BOOKING_STATUS_REASONS = [
  "GUEST_CANCELLED",
  "HOST_CANCELLED",
  "HOST_REJECTED",
  "HOST_RESPONSE_TIMEOUT",
  "HOLD_EXPIRED",
  "AVAILABILITY_LOST",
] as const;
export type BookingStatusReason = (typeof BOOKING_STATUS_REASONS)[number];

/**
 * How a Guest reaches their own Booking without an account.
 *
 * The reference is printed in emails and quoted over the phone, so it is not a
 * secret — this token is. Only its hash is stored, exactly like a session
 * token (milestone 05 §15, §66).
 */
export const bookingGuestAccessTokens = pgTable(
  "booking_guest_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_guest_access_tokens_token_hash_key").on(table.tokenHash),
    index("booking_guest_access_tokens_booking_idx").on(table.bookingId),
  ],
);

export const BOOKING_EVENT_TYPES = [
  "BOOKING_CREATED",
  "HOST_ACCEPTED",
  "HOST_REJECTED",
  "REQUEST_EXPIRED",
  "GUEST_CANCELLED",
  "HOST_CANCELLED",
  "HOLD_CREATED",
  "HOLD_EXPIRED",
  "HOLD_RELEASED",
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

export const ACTOR_TYPES = ["GUEST", "HOST", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * An append-only trail of what happened to a Booking.
 *
 * Deliberately *not* the source of truth for status — `bookings.status` stays
 * canonical (milestone 05 §38). This exists for audit, the timeline both sides
 * see, and answering "why did this happen?" months later.
 */
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    /** Small, non-sensitive context only — never a request payload. */
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("booking_events_booking_idx").on(table.bookingId),
    index("booking_events_created_at_idx").on(table.createdAt),
    check(
      "booking_events_actor_check",
      sql`${table.actorType} IN ('GUEST','HOST','SYSTEM')`,
    ),
  ],
);

export const NOTIFICATION_TYPES = [
  "BOOKING_REQUEST_CREATED",
  "BOOKING_REQUEST_ACCEPTED",
  "BOOKING_REQUEST_REJECTED",
  "BOOKING_REQUEST_EXPIRED",
  "BOOKING_REQUEST_REMINDER",
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED_BY_GUEST",
  "BOOKING_CANCELLED_BY_HOST",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = ["PENDING", "SENT", "FAILED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * One row per logical notification, keyed by `dedup_key`.
 *
 * The unique index is what stops a retried job from mailing somebody the same
 * thing five times: claiming the row is the permission to send
 * (milestone 05 §12).
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    recipientType: text("recipient_type").notNull(),
    recipientAddress: text("recipient_address").notNull(),
    status: text("status").notNull().default("PENDING"),
    dedupKey: text("dedup_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_dedup_key").on(table.dedupKey),
    index("notification_deliveries_booking_idx").on(table.bookingId),
    index("notification_deliveries_status_idx").on(table.status),
    check(
      "notification_deliveries_status_check",
      sql`${table.status} IN ('PENDING','SENT','FAILED')`,
    ),
    check(
      "notification_deliveries_recipient_check",
      sql`${table.recipientType} IN ('GUEST','HOST')`,
    ),
    check("notification_deliveries_attempts_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const OUTBOX_STATUSES = ["PENDING", "PROCESSING", "PROCESSED", "FAILED"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * Transactional outbox.
 *
 * A notification is written in the *same transaction* as the Booking change it
 * describes. Without this, a crash between COMMIT and `queue.add()` loses the
 * email silently — the Booking moves on and nobody is told
 * (milestone 05 §44).
 *
 * The payload holds ids only, never Guest details.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    // The processor scans for PENDING oldest-first.
    index("outbox_events_status_created_idx").on(table.status, table.createdAt),
    index("outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId),
    check(
      "outbox_events_status_check",
      sql`${table.status} IN ('PENDING','PROCESSING','PROCESSED','FAILED')`,
    ),
  ],
);

export type BookingGuestAccessTokenRow = typeof bookingGuestAccessTokens.$inferSelect;
export type BookingEventRow = typeof bookingEvents.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type OutboxEventRow = typeof outboxEvents.$inferSelect;
