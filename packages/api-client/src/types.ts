import type { components, operations } from "./schema";

/**
 * Every type here is derived from the API's own OpenAPI document, so the
 * contract cannot drift: regenerate with `pnpm api:types` and any breaking
 * backend change turns into a compile error in the web app.
 */
export type PriceQuote = components["schemas"]["PriceQuoteDto"];
export type PropertyImage = components["schemas"]["PropertyImageDto"];
export type PropertySummary = components["schemas"]["PropertySummaryDto"];
export type PropertyDetail = components["schemas"]["PropertyDetailDto"];
export type SearchResponse = components["schemas"]["SearchResponseDto"];
/** One entry of the canonical Amenity vocabulary served by GET /api/amenities. */
export type AmenityOption = components["schemas"]["AmenityDto"];

/** Auth — the session itself is an HttpOnly cookie the client never reads. */
export type AuthSession = components["schemas"]["AuthSessionDto"];
export type AuthUser = components["schemas"]["AuthUserDto"];
export type AuthHost = components["schemas"]["AuthHostDto"];
export type RegisterBody = components["schemas"]["RegisterDto"];
export type RegisterHostBody = components["schemas"]["RegisterHostDto"];
export type LoginBody = components["schemas"]["LoginDto"];

/** Host area — the private view of a Property, including its publish state. */
export type HostProperty = components["schemas"]["HostPropertyDetailDto"];
export type HostPropertySummary = components["schemas"]["HostPropertySummaryDto"];
export type HostPropertyImage = components["schemas"]["HostPropertyImageDto"];
export type HostPropertyAddress = components["schemas"]["HostPropertyAddressDto"];
export type HostPropertyCapacity = components["schemas"]["HostPropertyCapacityDto"];
export type HostPropertyPricing = components["schemas"]["HostPropertyPricingDto"];
export type PublishReadiness = components["schemas"]["PublishReadinessDto"];
export type PublishError = components["schemas"]["PublishErrorDto"];
export type PropertyNotReady = components["schemas"]["PropertyNotReadyDto"];
export type CreateHostPropertyBody = components["schemas"]["CreateHostPropertyDto"];
export type UpdateHostPropertyBody = components["schemas"]["UpdateHostPropertyDto"];
export type CreateUploadUrlBody = components["schemas"]["CreateUploadUrlDto"];
export type UploadUrl = components["schemas"]["UploadUrlDto"];
export type ConfirmImageBody = components["schemas"]["ConfirmImageDto"];

export type PropertyStatus = HostProperty["status"];

/** Availability — half-open `[startDate, endDate)` everywhere. */
export type HostCalendar = components["schemas"]["HostCalendarDto"];
export type HostCalendarBlock = components["schemas"]["HostCalendarBlockDto"];
export type PublicAvailability = components["schemas"]["PublicAvailabilityDto"];
export type UnavailableRange = components["schemas"]["UnavailableRangeDto"];
export type BlockDatesBody = components["schemas"]["BlockDatesDto"];
export type UnblockDatesBody = components["schemas"]["UnblockDatesDto"];

/** iCal import and export. */
export type ExternalCalendar = components["schemas"]["ExternalCalendarDto"];
export type CreateExternalCalendarBody =
  components["schemas"]["CreateExternalCalendarDto"];
export type UpdateExternalCalendarBody =
  components["schemas"]["UpdateExternalCalendarDto"];
export type CalendarExportToken = components["schemas"]["CalendarExportTokenDto"];
export type CalendarExportStatus = components["schemas"]["CalendarExportStatusDto"];
export type CalendarProvider = ExternalCalendar["provider"];

/**
 * Host operations — dashboard and the calendar spanning every Property. Both
 * are read models over PostgreSQL, never a second source of truth.
 */
export type HostDashboard = components["schemas"]["HostDashboardDto"];
export type AttentionItem = components["schemas"]["AttentionItemDto"];
export type AttentionType = AttentionItem["type"];
export type AttentionSeverity = AttentionItem["severity"];
export type OperationalBooking = components["schemas"]["OperationalBookingDto"];
export type HostToday = components["schemas"]["TodayDto"];
export type PropertiesOverview = components["schemas"]["PropertiesOverviewDto"];
export type CalendarSyncHealth = components["schemas"]["CalendarSyncHealthDto"];
export type HostAllCalendar = components["schemas"]["HostAllCalendarDto"];
export type HostAllCalendarProperty = components["schemas"]["HostAllCalendarPropertyDto"];
export type HostAllCalendarEvent = components["schemas"]["HostAllCalendarEventDto"];

/** Bookings. Stay stays half-open; the server owns the price. */
export type Booking = components["schemas"]["BookingDto"];
export type HostBooking = components["schemas"]["HostBookingDto"];
export type HostBookingsPage = components["schemas"]["HostBookingsPageDto"];
export type HostBookingsQuery = NonNullable<
  operations["HostBookingsController_list"]["parameters"]["query"]
>;
export type HostBookingSort = NonNullable<HostBookingsQuery["sort"]>;
export type BookingPrice = components["schemas"]["BookingPriceDto"];
export type CreateBookingBody = components["schemas"]["CreateBookingDto"];
export type GuestDetails = components["schemas"]["GuestDetailsDto"];
export type BookingStatus = Booking["status"];
export type BookingTimelineEntry = components["schemas"]["BookingTimelineEntryDto"];
export type BookingActions = components["schemas"]["BookingActionsDto"];

/**
 * Payments. Money is recognised only on a verified server-side signal from the
 * provider — the browser never decides that a Booking is paid.
 */
export type PaymentIntent = components["schemas"]["PaymentIntentDto"];
export type PaymentSync = components["schemas"]["PaymentSyncDto"];
export type PaymentState = components["schemas"]["PaymentStateDto"];
export type PaymentStatus = NonNullable<PaymentState["status"]>;
export type HostPaymentStatus = components["schemas"]["HostPaymentStatusDto"];
export type HostPaymentReadiness = HostPaymentStatus["readiness"];
export type OnboardingLink = components["schemas"]["OnboardingLinkDto"];

/**
 * Stay information and messaging. Sensitive access is withheld by the backend
 * until its reveal time — the client is never the thing hiding it.
 */
export type StayDetails = components["schemas"]["StayDetailsDto"];
export type StayPhase = StayDetails["phase"];
export type GuestSensitiveAccess = components["schemas"]["GuestSensitiveAccessDto"];
export type StayInformation = components["schemas"]["StayInformationDto"];
export type UpdateStayInformationBody = components["schemas"]["UpdateStayInformationDto"];
export type SensitiveAccess = components["schemas"]["SensitiveAccessDto"];
export type UpdateSensitiveAccessBody = components["schemas"]["UpdateSensitiveAccessDto"];
export type BookingAccessStatus = components["schemas"]["BookingAccessStatusDto"];

export type Message = components["schemas"]["MessageDto"];
export type MessagesPage = components["schemas"]["MessagesPageDto"];
export type MessageSenderType = Message["senderType"];

/**
 * Host settlement. Four different things, never conflated: the Payment (Guest
 * → Rezervio), the Settlement (what the Host is owed), the Transfer (platform
 * → connected account) and the Payout (connected account → bank).
 */
export type HostFinanceSummary = components["schemas"]["HostFinanceSummaryDto"];
export type HostBalance = components["schemas"]["HostBalanceDto"];
export type Settlement = components["schemas"]["SettlementDto"];
export type SettlementsPage = components["schemas"]["SettlementsPageDto"];
export type SettlementStatus = Settlement["status"];
export type HostPayout = components["schemas"]["HostPayoutDto"];

/** Account area: shared identity, profile and My Trips. */
export type Profile = components["schemas"]["ProfileDto"];
export type UpdateProfileBody = components["schemas"]["UpdateProfileDto"];
export type Trip = components["schemas"]["TripDto"];
export type TripsPage = components["schemas"]["TripsPageDto"];
export type TripCategory = Trip["category"];
export type BookingMode = Booking["bookingMode"];

export type SearchParams = NonNullable<
  operations["SearchController_find"]["parameters"]["query"]
>;

export type PropertyStayParams = NonNullable<
  operations["PropertiesController_findOne"]["parameters"]["query"]
>;

export type SortOption = NonNullable<SearchParams["sort"]>;
export type PropertyTypeCode = NonNullable<SearchParams["propertyType"]>[number];

/**
 * Admin and support.
 *
 * A read-only surface plus a small set of safe actions. Nothing here writes a
 * domain status: every action re-runs an existing command (milestone 11 §9).
 */
export type AdminDashboard = components["schemas"]["AdminDashboardDto"];
export type AdminStripeStatus = components["schemas"]["AdminStripeStatusDto"];
export type AdminSearchResponse = components["schemas"]["AdminSearchResponseDto"];
export type AdminSearchHit = components["schemas"]["AdminSearchHitDto"];
export type AdminSearchKind = AdminSearchHit["kind"];
export type AdminBookingRow = components["schemas"]["AdminBookingRowDto"];
export type AdminBookingsPage = components["schemas"]["AdminBookingsPageDto"];
export type AdminBookingDetail = components["schemas"]["AdminBookingDetailDto"];
export type AdminUserDetail = components["schemas"]["AdminUserDetailDto"];
export type AdminHostDetail = components["schemas"]["AdminHostDetailDto"];
export type AdminPropertyDetail = components["schemas"]["AdminPropertyDetailDto"];
export type AdminActionRecord = components["schemas"]["AdminActionRecordDto"];
export type AdminActionsPage = components["schemas"]["AdminActionsPageDto"];
export type AdminActionResult = components["schemas"]["AdminActionResultDto"];

export type OperationalIssue = components["schemas"]["OperationalIssueDto"];
export type IssueCategory = OperationalIssue["category"];
export type IssueSeverity = OperationalIssue["severity"];
export type OperationalIssuesPage = components["schemas"]["OperationalIssuesPageDto"];
export type IssueCount = components["schemas"]["IssueCountDto"];
export type JobsResponse = components["schemas"]["JobsResponseDto"];
export type JobQueue = components["schemas"]["JobQueueDto"];
export type FailedJob = components["schemas"]["FailedJobDto"];
export type AdminNotificationsPage = components["schemas"]["NotificationsPageDto"];
export type AdminNotificationRow = components["schemas"]["NotificationIssueDto"];
export type CalendarSyncPage = components["schemas"]["CalendarSyncPageDto"];
export type CalendarSyncRow = components["schemas"]["CalendarSyncRowDto"];
export type ReconciliationStatus = components["schemas"]["ReconciliationStatusDto"];

/** Liveness and readiness are different questions with different answers. */
export type Readiness = components["schemas"]["ReadinessResponseDto"];

/**
 * Connectivity with an external PMS or channel manager.
 *
 * Two providers, two genuinely different relationships: Rezervio calls a PMS,
 * and a channel manager calls Rezervio. The types below describe the Host's
 * and the operator's view of both — never their credentials.
 */
export type HostIntegrations = components["schemas"]["IntegrationsPageDto"];
export type HostIntegration = components["schemas"]["IntegrationDto"];
export type IntegrationStatus = HostIntegration["status"];
export type ConnectIntegrationResult = components["schemas"]["ConnectResultDto"];
export type ExternalListings = components["schemas"]["ExternalListingsDto"];
export type ExternalListing = components["schemas"]["ExternalListingDto"];
export type PropertyMapping = components["schemas"]["PropertyMappingDto"];
export type IntegrationSyncAttempt = components["schemas"]["SyncAttemptDto"];
export type AdminIntegration = components["schemas"]["AdminIntegrationDto"];
export type AdminIntegrationsPage = components["schemas"]["AdminIntegrationsPageDto"];

/**
 * Geocoding. An address the Host typed becomes the Property's canonical
 * latitude/longitude — every map in Rezervio reads those, and nothing derives
 * a point from a city name.
 */
export type GeocodeBody = components["schemas"]["GeocodeRequestDto"];
export type GeocodeResult = components["schemas"]["GeocodeResponseDto"];
export type GeocodePrecision = NonNullable<GeocodeResult["precision"]>;
