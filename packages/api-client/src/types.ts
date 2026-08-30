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

/** Bookings. Stay stays half-open; the server owns the price. */
export type Booking = components["schemas"]["BookingDto"];
export type HostBooking = components["schemas"]["HostBookingDto"];
export type BookingPrice = components["schemas"]["BookingPriceDto"];
export type CreateBookingBody = components["schemas"]["CreateBookingDto"];
export type GuestDetails = components["schemas"]["GuestDetailsDto"];
export type BookingStatus = Booking["status"];
export type BookingTimelineEntry = components["schemas"]["BookingTimelineEntryDto"];
export type BookingActions = components["schemas"]["BookingActionsDto"];

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
