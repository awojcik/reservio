import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  type AnyPgColumn,
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
 * Staff roles carried by an ordinary `User`.
 *
 * Deliberately not a second account system: support opens the same session as
 * everybody else and the role only widens what that session may read
 * (milestone 11 §3). SUPPORT is read plus the safe operational retries; ADMIN
 * adds nothing to the domain — there is no state an admin may set by hand.
 */
export const USER_ROLES = ["SUPPORT", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

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

    /**
     * Staff roles, empty for everyone who is not staff. An array rather than a
     * join table because the vocabulary is two words long and every read of it
     * is "does this session have a role", never "who has this role".
     */
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email),
    check("users_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
    check(
      "users_roles_check",
      sql`${table.roles} <@ ARRAY['SUPPORT','ADMIN']::text[]`,
    ),
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
  "BOOKING",
  "BOOKING_HOLD",
  "MAINTENANCE",
  /**
   * A reservation that exists in a connected PMS or channel manager.
   *
   * Deliberately distinct from EXTERNAL_CALENDAR: an iCal feed is a snapshot
   * of opaque busy periods, while this is a reservation we know by id and can
   * follow through modification and cancellation (milestone 12 §8).
   */
  "EXTERNAL_PROVIDER",
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

    /**
     * When a Host handed over the access details for *this* Booking ahead of
     * schedule. A per-Booking override on purpose: revealing early for one
     * Guest must not quietly move the Property's default for everyone else
     * (milestone 09 §20A).
     */
    sensitiveAccessRevealedAt: timestamp("sensitive_access_revealed_at", {
      withTimezone: true,
    }),
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
    /**
     * The Host dashboard asks "my bookings, in this state, arriving on this
     * date" — composite and Host-scoped, so the index serves arrivals,
     * upcoming stays and date-range filters without a scan.
     */
    index("bookings_host_status_check_in_idx").on(
      table.hostId,
      table.status,
      table.checkIn,
    ),
    /** Departures ask the same question against the other end of the Stay. */
    index("bookings_host_check_out_idx").on(table.hostId, table.checkOut),

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

    /**
     * Set for BOOKING blocks — the permanent claim a CONFIRMED Booking has on
     * the calendar. Unlike a hold this has no expiry and no join to check: a
     * confirmed Booking blocks the dates regardless of Redis, BullMQ or any
     * worker running (milestone 08 §22).
     */
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),

    /**
     * Set for EXTERNAL_PROVIDER blocks: the reservation in a connected PMS or
     * channel manager that this block exists because of.
     *
     * A block per reservation rather than per feed snapshot, because a
     * reservation has an identity we can follow: the same webhook delivered
     * twice updates one row instead of creating a second block, and a
     * cancellation removes exactly the dates it freed (milestone 12 §35).
     */
    externalReservationMappingId: uuid("external_reservation_mapping_id").references(
      (): AnyPgColumn => externalReservationMappings.id,
      { onDelete: "cascade" },
    ),

    /** Host-private; never exported and never shown publicly. */
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("availability_blocks_property_idx").on(table.propertyId),
    index("availability_blocks_external_calendar_idx").on(table.externalCalendarId),
    index("availability_blocks_booking_hold_idx").on(table.bookingHoldId),
    index("availability_blocks_booking_idx").on(table.bookingId),
    /**
     * One block per external reservation, enforced by the database.
     *
     * This is what makes "a duplicate webhook cannot create a duplicate block"
     * a guarantee rather than a hope about ordering (milestone 12 §35).
     */
    uniqueIndex("availability_blocks_external_reservation_key").on(
      table.externalReservationMappingId,
    ),

    check(
      "availability_blocks_source_check",
      sql`${table.sourceType} IN ('HOST_BLOCK','EXTERNAL_CALENDAR','BOOKING','BOOKING_HOLD','MAINTENANCE','EXTERNAL_PROVIDER')`,
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
    // And the same shape once more for the confirmed Booking block.
    check(
      "availability_blocks_booking_link_check",
      sql`(${table.sourceType} = 'BOOKING') = (${table.bookingId} IS NOT NULL)`,
    ),
    // And once more for a reservation held in a connected provider.
    check(
      "availability_blocks_external_reservation_link_check",
      sql`(${table.sourceType} = 'EXTERNAL_PROVIDER') = (${table.externalReservationMappingId} IS NOT NULL)`,
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
  /** Money arrived after the hold had already lapsed; it is refunded in full. */
  "PAYMENT_AFTER_HOLD_EXPIRY",
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
  "STAY_INSTRUCTIONS_READY",
  "SENSITIVE_ACCESS_READY",
  "STAY_CHECKOUT_REMINDER",
  "BOOKING_MESSAGE_TO_HOST",
  "BOOKING_MESSAGE_TO_GUEST",
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

/**
 * Payments.
 *
 * Money is only ever recognised on a verified server-side signal from the PSP;
 * the browser saying "it worked" changes nothing (milestone 08 §4). These
 * tables are the Rezervio-side record of what the provider told us, not a
 * mirror of the provider's own objects.
 */
export const PAYMENT_PROVIDERS = ["STRIPE"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Canonical Payment lifecycle. Deliberately *not* a 1:1 mapping of Stripe's
 * statuses — the domain needs fewer states than the provider exposes
 * (milestone 08 §8).
 */
export const PAYMENT_STATUSES = [
  "CREATED",
  "PROCESSING",
  "REQUIRES_ACTION",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** States in which a Payment is still on its way to an outcome. */
export const OPEN_PAYMENT_STATUSES = [
  "CREATED",
  "PROCESSING",
  "REQUIRES_ACTION",
] as const;

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),

    provider: text("provider").notNull().default("STRIPE"),
    /** Null until the provider has been called; set in a short follow-up write. */
    providerPaymentId: text("provider_payment_id"),

    status: text("status").notNull().default("CREATED"),

    /**
     * Copied from the Booking snapshot, never from the browser. A client that
     * proposes an amount is proposing a discount (milestone 08 §9).
     */
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),

    /**
     * What Rezervio keeps, snapshotted at payment time so a later change to
     * the rate cannot rewrite history. Settlement itself is milestone 10.
     */
    platformFeeAmountMinor: integer("platform_fee_amount_minor").notNull().default(0),

    /** Provider-side failure detail. Never card data — Rezervio never sees any. */
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    index("payments_booking_idx").on(table.bookingId),
    uniqueIndex("payments_provider_payment_id_key").on(table.providerPaymentId),
    index("payments_status_idx").on(table.status),

    /**
     * At most one Payment per Booking may be in flight. A Guest pressing "pay"
     * twice reuses the open Payment instead of opening a second PaymentIntent
     * against the same Stay (milestone 08 §43).
     */
    uniqueIndex("payments_booking_open_key")
      .on(table.bookingId)
      .where(sql`${table.status} IN ('CREATED','PROCESSING','REQUIRES_ACTION')`),

    check(
      "payments_provider_check",
      sql`${table.provider} IN ('STRIPE')`,
    ),
    check(
      "payments_status_check",
      sql`${table.status} IN ('CREATED','PROCESSING','REQUIRES_ACTION','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED')`,
    ),
    check("payments_amount_check", sql`${table.amountMinor} > 0`),
    check("payments_fee_check", sql`${table.platformFeeAmountMinor} >= 0`),
    check("payments_currency_check", sql`${table.currency} IN ('PLN','EUR','USD','GBP')`),
  ],
);

export const REFUND_TYPES = ["FULL", "PARTIAL"] as const;
export type RefundType = (typeof REFUND_TYPES)[number];

export const REFUND_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * Why money is going back. A closed vocabulary because the reason decides both
 * the Guest-facing wording and the uniqueness rule below.
 */
export const REFUND_REASONS = [
  "PAYMENT_AFTER_HOLD_EXPIRY",
  "AMOUNT_MISMATCH",
  "HOST_CANCELLED",
  "GUEST_CANCELLED",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),

    providerRefundId: text("provider_refund_id"),
    type: text("type").notNull(),
    status: text("status").notNull().default("PENDING"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),

    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (table) => [
    index("refunds_booking_idx").on(table.bookingId),
    uniqueIndex("refunds_provider_refund_id_key").on(table.providerRefundId),
    // Operational issue queries ask for refunds that are stuck or failed.
    index("refunds_status_idx").on(table.status),

    /**
     * Exactly one Refund per Payment per reason.
     *
     * This is what makes "a late successful payment is refunded once" a
     * database guarantee rather than a hope: two concurrent recovery paths can
     * both decide a refund is due, and only one row will exist
     * (milestone 08 §47).
     */
    uniqueIndex("refunds_payment_reason_key").on(table.paymentId, table.reason),

    check("refunds_type_check", sql`${table.type} IN ('FULL','PARTIAL')`),
    check(
      "refunds_status_check",
      sql`${table.status} IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')`,
    ),
    check(
      "refunds_reason_check",
      sql`${table.reason} IN ('PAYMENT_AFTER_HOLD_EXPIRY','AMOUNT_MISMATCH','HOST_CANCELLED','GUEST_CANCELLED')`,
    ),
    check("refunds_amount_check", sql`${table.amountMinor} > 0`),
  ],
);

/**
 * Every provider event we have seen, so replaying one has no second effect.
 *
 * Stripe retries deliveries and the CLI can replay them by hand; the unique
 * key below is what turns "at least once" delivery into "exactly one domain
 * effect" (milestone 08 §19).
 */
export const paymentProviderEvents = pgTable(
  "payment_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("STRIPE"),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Null while the event is claimed but its effect has not committed yet. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_provider_events_provider_event_key").on(
      table.provider,
      table.providerEventId,
    ),
    index("payment_provider_events_processed_idx").on(table.processedAt),
    check(
      "payment_provider_events_provider_check",
      sql`${table.provider} IN ('STRIPE')`,
    ),
  ],
);

/**
 * How ready a Host is to be paid. A deliberately small vocabulary — mirroring
 * the whole provider account object into our schema would make the provider's
 * model our model (milestone 08 §29).
 */
export const HOST_PAYMENT_READINESS = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "READY",
  "RESTRICTED",
] as const;
export type HostPaymentReadiness = (typeof HOST_PAYMENT_READINESS)[number];

export const hostPaymentAccounts = pgTable(
  "host_payment_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),

    provider: text("provider").notNull().default("STRIPE"),
    providerAccountId: text("provider_account_id").notNull(),

    onboardingStatus: text("onboarding_status").notNull().default("NOT_STARTED"),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One account per Host per provider, so "create" is naturally idempotent.
    uniqueIndex("host_payment_accounts_host_provider_key").on(table.hostId, table.provider),
    uniqueIndex("host_payment_accounts_provider_account_key").on(table.providerAccountId),
    check(
      "host_payment_accounts_provider_check",
      sql`${table.provider} IN ('STRIPE')`,
    ),
    check(
      "host_payment_accounts_status_check",
      sql`${table.onboardingStatus} IN ('NOT_STARTED','IN_PROGRESS','READY','RESTRICTED')`,
    ),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
export type PaymentProviderEventRow = typeof paymentProviderEvents.$inferSelect;
export type HostPaymentAccountRow = typeof hostPaymentAccounts.$inferSelect;

/**
 * What a Guest needs to know to actually use the place.
 *
 * Configured once per Property, not copied into every Booking: a Host who
 * fixes a wrong door description should fix it once, and a Guest arriving
 * tomorrow should see the correction (milestone 09 §4, §13).
 */
export const propertyStayInformation = pgTable(
  "property_stay_information",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    /**
     * Local wall-clock time, `HH:MM`. Deliberately not a UTC instant: "check-in
     * from 15:00" means three in the afternoon at the Property, whatever the
     * date and whatever daylight saving is doing (milestone 09 §7).
     */
    checkInTime: text("check_in_time").notNull().default("15:00"),
    checkOutTime: text("check_out_time").notNull().default("11:00"),

    arrivalInstructions: text("arrival_instructions"),
    parkingInstructions: text("parking_instructions"),
    wifiName: text("wifi_name"),
    /** Not a Rezervio credential, but still the Guest's to receive, not ours to log. */
    wifiPassword: text("wifi_password"),
    houseRules: text("house_rules"),
    departureInstructions: text("departure_instructions"),
    emergencyContact: text("emergency_contact"),

    /** How long before check-in the instructions go out. */
    instructionsSendOffsetHours: integer("instructions_send_offset_hours")
      .notNull()
      .default(24),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("property_stay_information_property_key").on(table.propertyId),
    check(
      "property_stay_information_check_in_time_check",
      sql`${table.checkInTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "property_stay_information_check_out_time_check",
      sql`${table.checkOutTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "property_stay_information_offset_check",
      sql`${table.instructionsSendOffsetHours} BETWEEN 1 AND 336`,
    ),
  ],
);

/**
 * How to get in. Kept apart from the rest of the stay information because it
 * is governed by different rules: encrypted at rest, and withheld until a
 * reveal time the backend enforces (milestone 09 §8, §9).
 */
export const propertySensitiveAccess = pgTable(
  "property_sensitive_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    /** All three are AES-256-GCM ciphertext; nothing here is readable in a dump. */
    accessInstructionsEncrypted: text("access_instructions_encrypted"),
    accessCodeEncrypted: text("access_code_encrypted"),
    keyboxLocationEncrypted: text("keybox_location_encrypted"),

    /** How long before check-in the code becomes readable. */
    revealOffsetHours: integer("reveal_offset_hours").notNull().default(6),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("property_sensitive_access_property_key").on(table.propertyId),
    check(
      "property_sensitive_access_offset_check",
      sql`${table.revealOffsetHours} BETWEEN 1 AND 336`,
    ),
  ],
);

/**
 * One conversation per Booking, and no other kind.
 *
 * Messaging exists because two people share a Stay — not because they are both
 * users of Rezervio. Without the Booking there is nothing to talk about and
 * nobody is authorised to (milestone 09 §24).
 */
export const bookingConversations = pgTable(
  "booking_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("booking_conversations_booking_key").on(table.bookingId)],
);

export const MESSAGE_SENDER_TYPES = ["GUEST", "HOST", "SYSTEM"] as const;
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

export const bookingMessages = pgTable(
  "booking_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => bookingConversations.id, { onDelete: "cascade" }),

    /**
     * Null for a Guest with no account: booking without one must keep working,
     * and `sender_type` already says which side wrote (milestone 09 §27).
     */
    senderUserId: uuid("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    senderType: text("sender_type").notNull(),
    /** Plain text. Never rendered as HTML anywhere. */
    body: text("body").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("booking_messages_conversation_idx").on(table.conversationId),
    index("booking_messages_created_at_idx").on(table.createdAt),
    // Cursor pagination reads newest-first within one conversation.
    index("booking_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    check(
      "booking_messages_sender_check",
      sql`${table.senderType} IN ('GUEST','HOST','SYSTEM')`,
    ),
    check("booking_messages_body_check", sql`length(btrim(${table.body})) BETWEEN 1 AND 4000`),
  ],
);

export type PropertyStayInformationRow = typeof propertyStayInformation.$inferSelect;
export type PropertySensitiveAccessRow = typeof propertySensitiveAccess.$inferSelect;
export type BookingConversationRow = typeof bookingConversations.$inferSelect;
export type BookingMessageRow = typeof bookingMessages.$inferSelect;

/**
 * Host settlement.
 *
 * Four different things, deliberately kept apart (milestone 10 §1):
 *
 * ```text
 * Payment    Guest              → Rezervio
 * Settlement how much the Host is owed, and from when
 * Transfer   platform balance   → Host connected account
 * Payout     connected account  → Host bank
 * ```
 *
 * A successful Payment does not mean the Host has been paid.
 */
export const SETTLEMENT_STATUSES = [
  "PENDING",
  "AVAILABLE",
  "TRANSFER_PENDING",
  "TRANSFERRED",
  "CANCELLED",
  "FAILED",
  "REVERSAL_PENDING",
  "REVERSED",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const bookingSettlements = pgTable(
  "booking_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),

    currency: text("currency").notNull(),

    /**
     * Copied from the Booking's own financial snapshot at settlement time and
     * never recomputed. Repricing an old Booking with today's commission would
     * quietly rewrite what a Host was promised (milestone 10 §7).
     */
    grossAmountMinor: integer("gross_amount_minor").notNull(),
    platformFeeMinor: integer("platform_fee_minor").notNull(),
    hostAmountMinor: integer("host_amount_minor").notNull(),

    status: text("status").notNull().default("PENDING"),
    /** Canonical instant, computed from check-in in the Property's time zone. */
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),

    provider: text("provider").notNull().default("STRIPE"),
    providerTransferId: text("provider_transfer_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp("available_at", { withTimezone: true }),
    transferredAt: timestamp("transferred_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    // One canonical Settlement per Booking; a replayed event cannot open a second.
    uniqueIndex("booking_settlements_booking_key").on(table.bookingId),
    index("booking_settlements_host_idx").on(table.hostId),
    index("booking_settlements_status_idx").on(table.status),
    // The release job asks "which are due?" — status and instant together.
    index("booking_settlements_status_release_idx").on(table.status, table.releaseAt),

    check(
      "booking_settlements_status_check",
      sql`${table.status} IN ('PENDING','AVAILABLE','TRANSFER_PENDING','TRANSFERRED','CANCELLED','FAILED','REVERSAL_PENDING','REVERSED')`,
    ),
    check("booking_settlements_gross_check", sql`${table.grossAmountMinor} >= 0`),
    check("booking_settlements_fee_check", sql`${table.platformFeeMinor} >= 0`),
    check("booking_settlements_host_amount_check", sql`${table.hostAmountMinor} >= 0`),
    // The arithmetic is an invariant, not a convention.
    check(
      "booking_settlements_split_check",
      sql`${table.hostAmountMinor} + ${table.platformFeeMinor} = ${table.grossAmountMinor}`,
    ),
    check(
      "booking_settlements_currency_check",
      sql`${table.currency} IN ('PLN','EUR','USD','GBP')`,
    ),
  ],
);

export const TRANSFER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "REVERSAL_PENDING",
  "REVERSED",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/**
 * Money leaving the platform balance for a Host's connected account.
 *
 * Separate Charges and Transfers: the Guest pays the platform, and the Host is
 * paid later, when the Stay has actually earned it (milestone 10 §12).
 */
export const hostTransfers = pgTable(
  "host_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => bookingSettlements.id, { onDelete: "restrict" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "restrict" }),

    provider: text("provider").notNull().default("STRIPE"),
    providerTransferId: text("provider_transfer_id"),

    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("PENDING"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    /**
     * At most one live Transfer per Settlement. This is what makes "two
     * workers cannot pay the Host twice" a database guarantee rather than a
     * hope about timing (milestone 10 §15).
     */
    uniqueIndex("host_transfers_settlement_live_key")
      .on(table.settlementId)
      .where(sql`${table.status} <> 'FAILED'`),
    index("host_transfers_settlement_idx").on(table.settlementId),
    index("host_transfers_host_idx").on(table.hostId),
    index("host_transfers_status_idx").on(table.status),
    uniqueIndex("host_transfers_provider_transfer_key").on(table.providerTransferId),

    check(
      "host_transfers_status_check",
      sql`${table.status} IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','REVERSAL_PENDING','REVERSED')`,
    ),
    check("host_transfers_amount_check", sql`${table.amountMinor} > 0`),
  ],
);

export const REVERSAL_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const;
export type ReversalStatus = (typeof REVERSAL_STATUSES)[number];

export const REVERSAL_REASONS = ["REFUNDED_AFTER_TRANSFER"] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];

/**
 * Pulling a Transfer back after the Guest was refunded.
 *
 * Under Separate Charges and Transfers, refunding the charge does not undo the
 * Transfer: the money already sits in the Host's account. The two have to be
 * coordinated explicitly (milestone 10 §19).
 */
export const hostTransferReversals = pgTable(
  "host_transfer_reversals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => hostTransfers.id, { onDelete: "restrict" }),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => bookingSettlements.id, { onDelete: "restrict" }),

    providerReversalId: text("provider_reversal_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("PENDING"),
    reason: text("reason").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    // Exactly one reversal per Transfer per reason.
    uniqueIndex("host_transfer_reversals_transfer_reason_key").on(
      table.transferId,
      table.reason,
    ),
    index("host_transfer_reversals_settlement_idx").on(table.settlementId),
    uniqueIndex("host_transfer_reversals_provider_key").on(table.providerReversalId),

    check(
      "host_transfer_reversals_status_check",
      sql`${table.status} IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')`,
    ),
    check(
      "host_transfer_reversals_reason_check",
      sql`${table.reason} IN ('REFUNDED_AFTER_TRANSFER')`,
    ),
    check("host_transfer_reversals_amount_check", sql`${table.amountMinor} > 0`),
  ],
);

export const PAYOUT_STATUSES = ["PENDING", "IN_TRANSIT", "PAID", "FAILED", "CANCELLED"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * Money leaving the Host's connected account for their bank.
 *
 * Rezervio does not initiate these: with an Express account on Stripe's default
 * schedule, the provider does. We observe them so a Host can see where their
 * money actually is (milestone 10 §17).
 */
export const hostPayouts = pgTable(
  "host_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),

    provider: text("provider").notNull().default("STRIPE"),
    providerPayoutId: text("provider_payout_id").notNull(),

    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("PENDING"),

    arrivalAt: timestamp("arrival_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    index("host_payouts_host_idx").on(table.hostId),
    uniqueIndex("host_payouts_provider_payout_key").on(table.providerPayoutId),
    index("host_payouts_status_idx").on(table.status),

    check(
      "host_payouts_status_check",
      sql`${table.status} IN ('PENDING','IN_TRANSIT','PAID','FAILED','CANCELLED')`,
    ),
    check("host_payouts_amount_check", sql`${table.amountMinor} >= 0`),
  ],
);

export type BookingSettlementRow = typeof bookingSettlements.$inferSelect;
export type HostTransferRow = typeof hostTransfers.$inferSelect;
export type HostTransferReversalRow = typeof hostTransferReversals.$inferSelect;
export type HostPayoutRow = typeof hostPayouts.$inferSelect;

/**
 * What support did, and to what.
 *
 * The point of this table is not bookkeeping for its own sake: every admin
 * action runs an existing domain command, so the row is the only place that
 * records *who* asked for it. Nothing here may carry a secret — not a provider
 * payload, not an access code, not a token (milestone 11 §11).
 */
export const ADMIN_ACTION_TYPES = [
  "RETRY_NOTIFICATION",
  "RETRY_REFUND",
  "RETRY_TRANSFER",
  "RETRY_JOB",
  "ICAL_RESYNC",
  "REFRESH_CONNECT_STATUS",
  "RECONCILE",
  // Connectivity with an external PMS or channel manager (milestone 12 §26).
  "RETRY_INTEGRATION_SYNC",
  "RECONCILE_INTEGRATION",
  "DISABLE_INTEGRATION",
  "RETRY_OUTBOUND_RESERVATION",
] as const;
export type AdminActionType = (typeof ADMIN_ACTION_TYPES)[number];

export const ADMIN_ACTION_TARGETS = [
  "BOOKING",
  "NOTIFICATION",
  "REFUND",
  "SETTLEMENT",
  "HOST",
  "EXTERNAL_CALENDAR",
  "JOB",
  "PLATFORM",
  "CONNECTION",
] as const;
export type AdminActionTarget = (typeof ADMIN_ACTION_TARGETS)[number];

export const ADMIN_ACTION_STATUSES = ["STARTED", "SUCCEEDED", "FAILED"] as const;
export type AdminActionStatus = (typeof ADMIN_ACTION_STATUSES)[number];

export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    actionType: text("action_type").notNull(),
    targetType: text("target_type").notNull(),
    /** Free-form on purpose: a BullMQ job id is not a UUID. */
    targetId: text("target_id").notNull(),
    status: text("status").notNull().default("STARTED"),

    /** Small, non-sensitive outcome summary. Never a provider payload. */
    metadataJson: text("metadata_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    // The audit list is newest-first, and that is the only way it is read.
    index("admin_actions_created_at_idx").on(table.createdAt),
    index("admin_actions_admin_idx").on(table.adminUserId),
    // "What has been done to this Booking?" on the lifecycle screen.
    index("admin_actions_target_idx").on(table.targetType, table.targetId),
    check(
      "admin_actions_type_check",
      sql`${table.actionType} IN ('RETRY_NOTIFICATION','RETRY_REFUND','RETRY_TRANSFER','RETRY_JOB','ICAL_RESYNC','REFRESH_CONNECT_STATUS','RECONCILE','RETRY_INTEGRATION_SYNC','RECONCILE_INTEGRATION','DISABLE_INTEGRATION','RETRY_OUTBOUND_RESERVATION')`,
    ),
    check(
      "admin_actions_target_check",
      sql`${table.targetType} IN ('BOOKING','NOTIFICATION','REFUND','SETTLEMENT','HOST','EXTERNAL_CALENDAR','JOB','PLATFORM','CONNECTION')`,
    ),
    check(
      "admin_actions_status_check",
      sql`${table.status} IN ('STARTED','SUCCEEDED','FAILED')`,
    ),
  ],
);

export type AdminActionRow = typeof adminActions.$inferSelect;

/**
 * Connectivity with an external PMS or channel manager.
 *
 * Two providers, two genuinely different relationships (milestone 12 §17):
 *
 * ```text
 * HOSTAWAY   Rezervio calls the PMS         — we are the client
 * CHANNEX    Channex calls Rezervio         — we are the channel/OTA
 * ```
 *
 * They share the bookkeeping below and nothing else. Treating the second as a
 * second copy of the first is the mistake this milestone exists to avoid.
 */
export const EXTERNAL_PROVIDERS = ["HOSTAWAY", "CHANNEX"] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];

export const CONNECTION_STATUSES = [
  "PENDING",
  "CONNECTED",
  /** Answering, but the last sync failed. Still usable, worth looking at. */
  "DEGRADED",
  "DISCONNECTED",
  /** Somebody has to do something outside Rezervio before this can work. */
  "ACTION_REQUIRED",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * Why a connection is not simply CONNECTED.
 *
 * `PARTNER_ACCESS_REQUIRED` is the honest state for a provider whose API we
 * have read but whose partner programme we have not been admitted to. It is
 * not a failure and not a bug — it is a business step that has not happened
 * (milestone 12 §21).
 */
export const CONNECTION_STATUS_REASONS = [
  "PARTNER_ACCESS_REQUIRED",
  "CREDENTIALS_MISSING",
  "CREDENTIALS_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "DISABLED_BY_HOST",
  "DISABLED_BY_ADMIN",
] as const;
export type ConnectionStatusReason = (typeof CONNECTION_STATUS_REASONS)[number];

export const externalInventoryConnections = pgTable(
  "external_inventory_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(),
    status: text("status").notNull().default("PENDING"),
    statusReason: text("status_reason"),

    /** The account id at the provider, when it has one. Not a secret. */
    externalAccountId: text("external_account_id"),

    /**
     * AES-256-GCM ciphertext, the same treatment an iCal import URL gets.
     * Never decrypted outside the adapter, never returned by any API, never
     * logged (milestone 12 §4, §38).
     */
    credentialsEncrypted: text("credentials_encrypted"),

    /** Non-secret settings only — sync horizon, provider-side account names. */
    configurationJson: text("configuration_json"),

    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    lastFailedSyncAt: timestamp("last_failed_sync_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * One connection per Host per provider. A Host with two Hostaway
     * connections would have two answers to "which listing is this Property?",
     * and no way to decide between them.
     */
    uniqueIndex("external_inventory_connections_host_provider_key").on(
      table.hostId,
      table.provider,
    ),
    index("external_inventory_connections_status_idx").on(table.status),
    check(
      "external_inventory_connections_provider_check",
      sql`${table.provider} IN ('HOSTAWAY','CHANNEX')`,
    ),
    check(
      "external_inventory_connections_status_check",
      sql`${table.status} IN ('PENDING','CONNECTED','DEGRADED','DISCONNECTED','ACTION_REQUIRED')`,
    ),
    check(
      "external_inventory_connections_reason_check",
      sql`${table.statusReason} IS NULL OR ${table.statusReason} IN ('PARTNER_ACCESS_REQUIRED','CREDENTIALS_MISSING','CREDENTIALS_REJECTED','PROVIDER_UNAVAILABLE','DISABLED_BY_HOST','DISABLED_BY_ADMIN')`,
    ),
  ],
);

export const MAPPING_STATUSES = ["ACTIVE", "PAUSED"] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

/**
 * Which Rezervio Property is which listing at the provider.
 *
 * Always confirmed by the Host. A name match is a suggestion, never a
 * decision: auto-mapping "Apartament 2" to the wrong listing would start
 * blocking the wrong calendar, and nobody would notice until a Guest arrived
 * at an occupied flat (milestone 12 §11, §23).
 */
export const externalPropertyMappings = pgTable(
  "external_property_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => externalInventoryConnections.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    externalPropertyId: text("external_property_id").notNull(),
    externalPropertyName: text("external_property_name"),
    status: text("status").notNull().default("ACTIVE"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Both directions are unique: one Property maps to one listing, and one
    // listing maps to one Property. Either duplicate would make the sync
    // ambiguous in a way no later code could resolve.
    uniqueIndex("external_property_mappings_connection_property_key").on(
      table.connectionId,
      table.propertyId,
    ),
    uniqueIndex("external_property_mappings_connection_external_key").on(
      table.connectionId,
      table.externalPropertyId,
    ),
    index("external_property_mappings_property_idx").on(table.propertyId),
    check("external_property_mappings_status_check", sql`${table.status} IN ('ACTIVE','PAUSED')`),
  ],
);

export const RESERVATION_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type ReservationDirection = (typeof RESERVATION_DIRECTIONS)[number];

export const RESERVATION_MAPPING_STATUSES = [
  /** Outbound only: claimed, not yet acknowledged by the provider. */
  "PENDING",
  "ACTIVE",
  "CANCELLED",
  "FAILED",
] as const;
export type ReservationMappingStatus = (typeof RESERVATION_MAPPING_STATUSES)[number];

/**
 * The correspondence between a reservation there and a reservation here.
 *
 * Inbound rows have no `booking_id`: an external reservation is a fact about
 * somebody else's calendar, not a Rezervio Booking. Manufacturing a full
 * Booking for each one would invent a Guest, a price and a payment that never
 * existed (milestone 12 §13).
 */
export const externalReservationMappings = pgTable(
  "external_reservation_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => externalInventoryConnections.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),

    externalReservationId: text("external_reservation_id").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),

    direction: text("direction").notNull(),
    status: text("status").notNull().default("ACTIVE"),

    /** The Stay as the provider states it. Half-open, like everything else. */
    checkIn: date("check_in"),
    checkOut: date("check_out"),

    lastErrorCode: text("last_error_code"),
    attemptCount: integer("attempt_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * The same provider reservation, seen twice, is one row. This is what
     * makes a replayed webhook and a polling pass that overlaps it converge on
     * one effect (milestone 12 §35).
     */
    uniqueIndex("external_reservation_mappings_connection_external_key").on(
      table.connectionId,
      table.externalReservationId,
    ),
    /**
     * And at most one live outbound push per Booking. Claiming this row is
     * what a retried push loses on, so a duplicate job cannot create a second
     * reservation at the provider (milestone 12 §14).
     */
    uniqueIndex("external_reservation_mappings_outbound_booking_key")
      .on(table.connectionId, table.bookingId)
      .where(sql`${table.direction} = 'OUTBOUND' AND ${table.status} <> 'FAILED'`),
    index("external_reservation_mappings_property_idx").on(table.propertyId),
    index("external_reservation_mappings_status_idx").on(table.status),
    index("external_reservation_mappings_booking_idx").on(table.bookingId),
    check(
      "external_reservation_mappings_provider_check",
      sql`${table.provider} IN ('HOSTAWAY','CHANNEX')`,
    ),
    check(
      "external_reservation_mappings_direction_check",
      sql`${table.direction} IN ('INBOUND','OUTBOUND')`,
    ),
    check(
      "external_reservation_mappings_status_check",
      sql`${table.status} IN ('PENDING','ACTIVE','CANCELLED','FAILED')`,
    ),
    check(
      "external_reservation_mappings_stay_check",
      sql`${table.checkIn} IS NULL OR ${table.checkOut} IS NULL OR ${table.checkOut} > ${table.checkIn}`,
    ),
    check("external_reservation_mappings_attempts_check", sql`${table.attemptCount} >= 0`),
  ],
);

/**
 * Every provider event we have seen.
 *
 * The same shape and the same reasoning as `payment_provider_events`: a
 * provider delivers at least once and can replay by hand, and inserting the
 * row is the permission to process it. Kept separate from the payment table
 * because the two vocabularies have nothing to do with each other and a shared
 * table would need a discriminator on every read (milestone 12 §7).
 *
 * The payload itself is not stored — only its hash, which is enough to notice
 * that a redelivery differs from the original without keeping somebody's Guest
 * data in a diagnostics table.
 */
export const externalProviderEvents = pgTable(
  "external_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    connectionId: uuid("connection_id").references(() => externalInventoryConnections.id, {
      onDelete: "cascade",
    }),

    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash"),

    /** Null while the event is claimed but its effect has not committed yet. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("external_provider_events_provider_event_key").on(
      table.provider,
      table.providerEventId,
    ),
    index("external_provider_events_processed_idx").on(table.processedAt),
    index("external_provider_events_connection_idx").on(table.connectionId),
    check(
      "external_provider_events_provider_check",
      sql`${table.provider} IN ('HOSTAWAY','CHANNEX')`,
    ),
  ],
);

export const SYNC_TYPES = [
  "PROPERTY_DISCOVERY",
  "INBOUND_RESERVATIONS",
  "OUTBOUND_PUSH",
  "OUTBOUND_CANCEL",
  "RECONCILIATION",
  "WEBHOOK",
  "CONNECTION_CHECK",
] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

export const SYNC_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/**
 * What each sync did, and whether it worked.
 *
 * Counts and a code, never the provider's response. A support screen needs to
 * know that forty reservations were read and two failed; it does not need — and
 * must not keep — the forty payloads (milestone 12 §7).
 */
export const externalSyncAttempts = pgTable(
  "external_sync_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => externalInventoryConnections.id, { onDelete: "cascade" }),

    syncType: text("sync_type").notNull(),
    status: text("status").notNull().default("RUNNING"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    itemsProcessed: integer("items_processed").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    errorCode: text("error_code"),
  },
  (table) => [
    // The panel reads one connection's history, newest first.
    index("external_sync_attempts_connection_started_idx").on(
      table.connectionId,
      table.startedAt,
    ),
    index("external_sync_attempts_status_idx").on(table.status),
    check(
      "external_sync_attempts_type_check",
      sql`${table.syncType} IN ('PROPERTY_DISCOVERY','INBOUND_RESERVATIONS','OUTBOUND_PUSH','OUTBOUND_CANCEL','RECONCILIATION','WEBHOOK','CONNECTION_CHECK')`,
    ),
    check(
      "external_sync_attempts_status_check",
      sql`${table.status} IN ('RUNNING','SUCCEEDED','FAILED')`,
    ),
    check("external_sync_attempts_processed_check", sql`${table.itemsProcessed} >= 0`),
    check("external_sync_attempts_failed_check", sql`${table.itemsFailed} >= 0`),
  ],
);

export type ExternalInventoryConnectionRow = typeof externalInventoryConnections.$inferSelect;
export type ExternalPropertyMappingRow = typeof externalPropertyMappings.$inferSelect;
export type ExternalReservationMappingRow = typeof externalReservationMappings.$inferSelect;
export type ExternalProviderEventRow = typeof externalProviderEvents.$inferSelect;
export type ExternalSyncAttemptRow = typeof externalSyncAttempts.$inferSelect;
