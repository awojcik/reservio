import type {
  AmenityOption,
  Profile,
  RegisterHostBody,
  Trip,
  TripsPage,
  UpdateProfileBody,
  Booking,
  CreateBookingBody,
  HostAllCalendar,
  HostBooking,
  HostBookingsPage,
  HostBookingsQuery,
  HostDashboard,
  HostPaymentStatus,
  OnboardingLink,
  PaymentIntent,
  PaymentSync,
  HostFinanceSummary,
  HostPayout,
  Settlement,
  SettlementsPage,
  BookingAccessStatus,
  Message,
  MessagesPage,
  SensitiveAccess,
  StayDetails,
  StayInformation,
  UpdateSensitiveAccessBody,
  UpdateStayInformationBody,
  BlockDatesBody,
  CalendarExportStatus,
  CalendarExportToken,
  CreateExternalCalendarBody,
  ExternalCalendar,
  HostCalendar,
  PublicAvailability,
  UnblockDatesBody,
  UpdateExternalCalendarBody,
  AuthSession,
  ConfirmImageBody,
  CreateHostPropertyBody,
  CreateUploadUrlBody,
  HostProperty,
  HostPropertyImage,
  HostPropertySummary,
  LoginBody,
  PropertyDetail,
  PropertyStayParams,
  RegisterBody,
  SearchParams,
  SearchResponse,
  UpdateHostPropertyBody,
  UploadUrl,
  GeocodeBody,
  GeocodeResult,
  AdminActionResult,
  AdminActionsPage,
  AdminBookingDetail,
  AdminBookingsPage,
  AdminDashboard,
  AdminHostDetail,
  AdminNotificationsPage,
  AdminPropertyDetail,
  AdminSearchResponse,
  AdminStripeStatus,
  AdminUserDetail,
  CalendarSyncPage,
  JobsResponse,
  OperationalIssuesPage,
  ReconciliationStatus,
  AdminIntegrationsPage,
  ConnectIntegrationResult,
  ExternalListings,
  HostIntegrations,
  PropertyMapping,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed JSON body, when the API sent one — publish errors carry detail. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

type RequestOptions = {
  signal?: AbortSignal;
  /** Next.js fetch caching; ignored in the browser. */
  cache?: RequestCache;
  revalidate?: number | false;
  /** Per-request headers, e.g. Idempotency-Key. */
  headers?: Record<string, string>;
};

export type ClientOptions = {
  /**
   * Forwarded on every request. The browser needs "include" so the session
   * cookie travels to the API on another port; Next.js on the server passes an
   * explicit Cookie header instead.
   */
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
};

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * A thin typed wrapper over fetch — no SDK, no client-side caching layer.
 * `baseUrl` differs by caller: the browser uses the public URL, Next.js on the
 * server can talk to the API directly.
 */
export function createApiClient(baseUrl: string, clientOptions: ClientOptions = {}) {
  const root = baseUrl.replace(/\/$/, "");

  async function send<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const { signal, cache, revalidate, headers } = options;

    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        signal,
        cache,
        credentials: clientOptions.credentials,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...clientOptions.headers,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(revalidate === undefined ? {} : { next: { revalidate } }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Connection refused, DNS failure, offline — the API is simply not there.
      throw new ApiError("Nie udało się połączyć z API Rezervio.", 0);
    }

    if (!response.ok) {
      // Publish rejections and validation errors carry a body worth keeping.
      const parsed = await response.json().catch(() => undefined);
      throw new ApiError(
        `Żądanie do API nie powiodło się (${response.status}).`,
        response.status,
        parsed,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  function request<T>(path: string, options?: RequestOptions): Promise<T> {
    return send<T>("GET", path, undefined, options);
  }

  return {
    // ---- public ----
    searchProperties(params: SearchParams, options?: RequestOptions) {
      return request<SearchResponse>(
        `/search${toQueryString(params as Record<string, unknown>)}`,
        options,
      );
    },

    getProperty(slug: string, params: PropertyStayParams = {}, options?: RequestOptions) {
      return request<PropertyDetail>(
        `/properties/${encodeURIComponent(slug)}${toQueryString(params as Record<string, unknown>)}`,
        options,
      );
    },

    listAmenities(options?: RequestOptions) {
      return request<AmenityOption[]>("/amenities", options);
    },

    /** Taken dates for a published Property; sources are never revealed. */
    getPublicAvailability(
      slug: string,
      params: { from: string; to: string },
      options?: RequestOptions,
    ) {
      return request<PublicAvailability>(
        `/properties/${encodeURIComponent(slug)}/availability${toQueryString(params)}`,
        options,
      );
    },

    health(options?: RequestOptions) {
      return request<{ status: string }>("/health", options);
    },

    // ---- auth ----
    /** General sign-up: creates a User, no Host profile. */
    register(body: RegisterBody) {
      return send<AuthSession>("POST", "/auth/register", body);
    },

    /** Sign-up that also opens a Host profile. */
    registerHost(body: RegisterHostBody) {
      return send<AuthSession>("POST", "/auth/register/host", body);
    },

    login(body: LoginBody) {
      return send<AuthSession>("POST", "/auth/login", body);
    },

    logout() {
      return send<void>("POST", "/auth/logout", undefined);
    },

    /** The single source of truth for auth state (milestone 02 §62). */
    me(options?: RequestOptions) {
      return request<AuthSession>("/auth/me", options);
    },

    // ---- account ----
    getProfile(options?: RequestOptions) {
      return request<Profile>("/account/profile", options);
    },

    updateProfile(body: UpdateProfileBody) {
      return send<Profile>("PATCH", "/account/profile", body);
    },

    listTrips(
      params: { category?: string; limit?: number; cursor?: string } = {},
      options?: RequestOptions,
    ) {
      return request<TripsPage>(`/account/bookings${toQueryString(params)}`, options);
    },

    getTrip(reference: string, options?: RequestOptions) {
      return request<Trip>(`/account/bookings/${encodeURIComponent(reference)}`, options);
    },

    /**
     * Attaches an anonymous Booking to the signed-in account. Needs the Guest
     * access token as well as the session — the reference alone is not proof.
     */
    claimBooking(reference: string, token?: string) {
      return send<Booking>(
        "POST",
        `/bookings/${encodeURIComponent(reference)}/claim${token ? `?token=${encodeURIComponent(token)}` : ""}`,
        undefined,
      );
    },

    // ---- host ----
    listHostProperties(options?: RequestOptions) {
      return request<HostPropertySummary[]>("/host/properties", options);
    },

    createHostProperty(body: CreateHostPropertyBody) {
      return send<HostProperty>("POST", "/host/properties", body);
    },

    getHostProperty(id: string, options?: RequestOptions) {
      return request<HostProperty>(`/host/properties/${id}`, options);
    },

    updateHostProperty(id: string, body: UpdateHostPropertyBody) {
      return send<HostProperty>("PATCH", `/host/properties/${id}`, body);
    },

    publishProperty(id: string) {
      return send<HostProperty>("POST", `/host/properties/${id}/publish`, undefined);
    },

    unpublishProperty(id: string) {
      return send<HostProperty>("POST", `/host/properties/${id}/unpublish`, undefined);
    },

    archiveProperty(id: string) {
      return send<HostProperty>("POST", `/host/properties/${id}/archive`, undefined);
    },

    createImageUploadUrl(id: string, body: CreateUploadUrlBody) {
      return send<UploadUrl>("POST", `/host/properties/${id}/images/upload-url`, body);
    },

    confirmImage(id: string, body: ConfirmImageBody) {
      return send<HostPropertyImage[]>("POST", `/host/properties/${id}/images`, body);
    },

    reorderImages(id: string, imageIds: string[]) {
      return send<HostPropertyImage[]>("PUT", `/host/properties/${id}/images/order`, {
        imageIds,
      });
    },

    deleteImage(id: string, imageId: string) {
      return send<HostPropertyImage[]>(
        "DELETE",
        `/host/properties/${id}/images/${imageId}`,
        undefined,
      );
    },

    // ---- bookings ----
    /**
     * `Idempotency-Key` is required: a retried submission must return the same
     * Booking rather than reserving the dates twice.
     */
    createBooking(body: CreateBookingBody, idempotencyKey: string) {
      return send<Booking>("POST", "/bookings", body, {
        headers: { "idempotency-key": idempotencyKey },
      });
    },

    /** Requires Guest access: a token cookie, or `?token=` on the first visit. */
    getBooking(reference: string, options?: RequestOptions) {
      return request<Booking>(`/bookings/${encodeURIComponent(reference)}`, options);
    },

    /** Exchanges a token from an email link for an HttpOnly cookie. */
    exchangeBookingAccess(reference: string, token: string) {
      return send<Booking>("POST", `/bookings/${encodeURIComponent(reference)}/access`, {
        token,
      });
    },

    cancelBooking(reference: string) {
      return send<Booking>(
        "POST",
        `/bookings/${encodeURIComponent(reference)}/cancel`,
        undefined,
      );
    },

    listHostBookings(params: HostBookingsQuery = {}, options?: RequestOptions) {
      return request<HostBookingsPage>(`/host/bookings${toQueryString(params)}`, options);
    },

    getHostBooking(id: string, options?: RequestOptions) {
      return request<HostBooking>(`/host/bookings/${id}`, options);
    },

    acceptBooking(id: string) {
      return send<HostBooking>("POST", `/host/bookings/${id}/accept`, undefined);
    },

    rejectBooking(id: string) {
      return send<HostBooking>("POST", `/host/bookings/${id}/reject`, undefined);
    },

    cancelHostBooking(id: string) {
      return send<HostBooking>("POST", `/host/bookings/${id}/cancel`, undefined);
    },

    // ---- stay information ----
    /** Requires Guest access, exactly like reading the Booking does. */
    getStayDetails(reference: string, options?: RequestOptions) {
      return request<StayDetails>(
        `/bookings/${encodeURIComponent(reference)}/stay`,
        options,
      );
    },

    getHostStayInformation(propertyId: string, options?: RequestOptions) {
      return request<StayInformation>(
        `/host/properties/${propertyId}/stay-information`,
        options,
      );
    },

    saveHostStayInformation(propertyId: string, body: UpdateStayInformationBody) {
      return send<StayInformation>(
        "PUT",
        `/host/properties/${propertyId}/stay-information`,
        body,
      );
    },

    getHostSensitiveAccess(propertyId: string, options?: RequestOptions) {
      return request<SensitiveAccess>(
        `/host/properties/${propertyId}/sensitive-access`,
        options,
      );
    },

    saveHostSensitiveAccess(propertyId: string, body: UpdateSensitiveAccessBody) {
      return send<SensitiveAccess>(
        "PUT",
        `/host/properties/${propertyId}/sensitive-access`,
        body,
      );
    },

    getBookingAccessStatus(bookingId: string, options?: RequestOptions) {
      return request<BookingAccessStatus>(
        `/host/bookings/${bookingId}/sensitive-access`,
        options,
      );
    },

    /**
     * Hands the access details to this Guest now. Scoped to one Booking — the
     * Property's default reveal timing is untouched.
     */
    revealBookingAccess(bookingId: string) {
      return send<BookingAccessStatus>(
        "POST",
        `/host/bookings/${bookingId}/sensitive-access/reveal`,
        undefined,
      );
    },

    // ---- messaging ----
    getGuestMessages(
      reference: string,
      params: { limit?: number; before?: string } = {},
      options?: RequestOptions,
    ) {
      return request<MessagesPage>(
        `/bookings/${encodeURIComponent(reference)}/messages${toQueryString(params)}`,
        options,
      );
    },

    sendGuestMessage(reference: string, body: string) {
      return send<Message>("POST", `/bookings/${encodeURIComponent(reference)}/messages`, {
        body,
      });
    },

    getHostMessages(
      bookingId: string,
      params: { limit?: number; before?: string } = {},
      options?: RequestOptions,
    ) {
      return request<MessagesPage>(
        `/host/bookings/${bookingId}/messages${toQueryString(params)}`,
        options,
      );
    },

    sendHostMessage(bookingId: string, body: string) {
      return send<Message>("POST", `/host/bookings/${bookingId}/messages`, { body });
    },

    // ---- payments ----
    /**
     * Starts (or resumes) paying for a Booking. Requires Guest access, exactly
     * like reading the Booking does.
     */
    startPayment(reference: string, options?: RequestOptions) {
      return send<PaymentIntent>(
        "POST",
        `/bookings/${encodeURIComponent(reference)}/payment`,
        undefined,
        options,
      );
    },

    /**
     * Asks the backend to reconcile a payment with the provider.
     *
     * Sends nothing: it is a request to go and look, not a claim about what
     * happened. Only the provider's own answer moves a Booking.
     */
    syncPayment(reference: string, options?: RequestOptions) {
      return send<PaymentSync>(
        "POST",
        `/bookings/${encodeURIComponent(reference)}/payment/sync`,
        undefined,
        options,
      );
    },

    createHostPaymentAccount() {
      return send<HostPaymentStatus>("POST", "/host/payments/connect-account", undefined);
    },

    createHostOnboardingLink() {
      return send<OnboardingLink>("POST", "/host/payments/onboarding-link", undefined);
    },

    getHostPaymentStatus(options?: RequestOptions) {
      return request<HostPaymentStatus>("/host/payments/status", options);
    },

    // ---- host settlements ----
    getHostFinanceSummary(options?: RequestOptions) {
      return request<HostFinanceSummary>("/host/payments/summary", options);
    },

    listHostSettlements(
      params: { limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<SettlementsPage>(`/host/settlements${toQueryString(params)}`, options);
    },

    /** Sandbox only: skips waiting for the clock, keeps every other rule. */
    releaseSettlementNow(settlementId: string) {
      return send<Settlement>(
        "POST",
        `/host/settlements/${settlementId}/release-now`,
        undefined,
      );
    },

    listHostPayouts(options?: RequestOptions) {
      return request<HostPayout[]>("/host/payouts", options);
    },

    // ---- host operations ----
    /** Everything the action-first dashboard shows, in one request. */
    getHostDashboard(options?: RequestOptions) {
      return request<HostDashboard>("/host/dashboard", options);
    },

    /** One calendar across every Property of the Host. */
    getHostAllCalendar(
      params: { from: string; to: string; propertyId?: string; limit?: number },
      options?: RequestOptions,
    ) {
      return request<HostAllCalendar>(`/host/calendar${toQueryString(params)}`, options);
    },

    // ---- calendar ----
    getHostCalendar(
      id: string,
      params: { from: string; to: string },
      options?: RequestOptions,
    ) {
      return request<HostCalendar>(
        `/host/properties/${id}/calendar${toQueryString(params)}`,
        options,
      );
    },

    blockDates(id: string, body: BlockDatesBody) {
      return send<HostCalendar>("POST", `/host/properties/${id}/availability/block`, body);
    },

    unblockDates(id: string, body: UnblockDatesBody) {
      return send<HostCalendar>("POST", `/host/properties/${id}/availability/unblock`, body);
    },

    // ---- external calendars ----
    listExternalCalendars(id: string, options?: RequestOptions) {
      return request<ExternalCalendar[]>(`/host/properties/${id}/external-calendars`, options);
    },

    createExternalCalendar(id: string, body: CreateExternalCalendarBody) {
      return send<ExternalCalendar>("POST", `/host/properties/${id}/external-calendars`, body);
    },

    updateExternalCalendar(
      id: string,
      calendarId: string,
      body: UpdateExternalCalendarBody,
    ) {
      return send<ExternalCalendar>(
        "PATCH",
        `/host/properties/${id}/external-calendars/${calendarId}`,
        body,
      );
    },

    deleteExternalCalendar(id: string, calendarId: string) {
      return send<void>(
        "DELETE",
        `/host/properties/${id}/external-calendars/${calendarId}`,
        undefined,
      );
    },

    syncExternalCalendar(id: string, calendarId: string) {
      return send<{ status: string }>(
        "POST",
        `/host/properties/${id}/external-calendars/${calendarId}/sync`,
        undefined,
      );
    },

    // ---- export ----
    getCalendarExport(id: string, options?: RequestOptions) {
      return request<CalendarExportStatus>(`/host/properties/${id}/calendar-export`, options);
    },

    createCalendarExport(id: string) {
      return send<CalendarExportToken>("POST", `/host/properties/${id}/calendar-export`, undefined);
    },

    regenerateCalendarExport(id: string) {
      return send<CalendarExportToken>(
        "POST",
        `/host/properties/${id}/calendar-export/regenerate`,
        undefined,
      );
    },

    revokeCalendarExport(id: string) {
      return send<void>("DELETE", `/host/properties/${id}/calendar-export`, undefined);
    },

    /**
     * Address → point, for the Property editor. Server-side because the
     * geocoder's usage policy asks for rate limiting and an identifying
     * User-Agent, neither of which a browser can be held to.
     */
    geocodeAddress(body: GeocodeBody) {
      return send<GeocodeResult>("POST", "/host/geocode", body);
    },

    // ---- admin ----
    /**
     * Every route below is guarded server-side by role. The client is a
     * convenience, never the protection — a 403 is the expected answer for
     * anybody without SUPPORT or ADMIN (milestone 11 §4).
     */
    getAdminDashboard(options?: RequestOptions) {
      return request<AdminDashboard>("/admin/dashboard", options);
    },

    adminSearch(params: { q: string; limit?: number }, options?: RequestOptions) {
      return request<AdminSearchResponse>(`/admin/search${toQueryString(params)}`, options);
    },

    listAdminBookings(
      params: { search?: string; status?: string; limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<AdminBookingsPage>(`/admin/bookings${toQueryString(params)}`, options);
    },

    getAdminBooking(id: string, options?: RequestOptions) {
      return request<AdminBookingDetail>(`/admin/bookings/${id}`, options);
    },

    getAdminUser(id: string, options?: RequestOptions) {
      return request<AdminUserDetail>(`/admin/users/${id}`, options);
    },

    getAdminHost(id: string, options?: RequestOptions) {
      return request<AdminHostDetail>(`/admin/hosts/${id}`, options);
    },

    getAdminProperty(id: string, options?: RequestOptions) {
      return request<AdminPropertyDetail>(`/admin/properties/${id}`, options);
    },

    listOperationalIssues(
      params: { category?: string; severity?: string; limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<OperationalIssuesPage>(`/admin/operations${toQueryString(params)}`, options);
    },

    getAdminJobs(options?: RequestOptions) {
      return request<JobsResponse>("/admin/jobs", options);
    },

    listAdminNotifications(
      params: { status?: string; limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<AdminNotificationsPage>(
        `/admin/notifications${toQueryString(params)}`,
        options,
      );
    },

    listAdminCalendars(
      params: { limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<CalendarSyncPage>(`/admin/ical${toQueryString(params)}`, options);
    },

    getAdminStripeStatus(options?: RequestOptions) {
      return request<AdminStripeStatus>("/admin/stripe", options);
    },

    getReconciliationStatus(options?: RequestOptions) {
      return request<ReconciliationStatus>("/admin/reconciliation", options);
    },

    listAdminActions(
      params: { limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<AdminActionsPage>(`/admin/actions${toQueryString(params)}`, options);
    },

    // ---- admin actions ----
    retryNotification(notificationId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/retry-notification", {
        notificationId,
      });
    },

    retryRefund(refundId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/retry-refund", { refundId });
    },

    retryTransfer(settlementId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/retry-transfer", { settlementId });
    },

    resyncCalendar(externalCalendarId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/ical-resync", {
        externalCalendarId,
      });
    },

    refreshConnectStatus(hostId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/refresh-connect", { hostId });
    },

    runReconciliation(scope: "payment" | "settlement" | "transfer" | "payout" | "all") {
      return send<AdminActionResult>("POST", "/admin/actions/reconcile", { scope });
    },

    retryJob(queue: string, jobId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/retry-job", { queue, jobId });
    },

    listAdminIntegrations(
      params: { limit?: number; offset?: number } = {},
      options?: RequestOptions,
    ) {
      return request<AdminIntegrationsPage>(
        `/admin/integrations${toQueryString(params)}`,
        options,
      );
    },

    retryIntegrationSync(connectionId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/retry-integration-sync", {
        connectionId,
      });
    },

    reconcileIntegration(connectionId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/reconcile-integration", {
        connectionId,
      });
    },

    disableIntegration(connectionId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/disable-integration", {
        connectionId,
      });
    },

    retryOutboundReservation(bookingId: string) {
      return send<AdminActionResult>("POST", "/admin/actions/retry-outbound-reservation", {
        bookingId,
      });
    },

    // ---- host integrations ----
    /**
     * The Host's connections to external systems. Credentials are write-only:
     * they go in through `connectHostaway` and never come back out.
     */
    getHostIntegrations(options?: RequestOptions) {
      return request<HostIntegrations>("/host/integrations", options);
    },

    connectHostaway(body: { accountId: string; apiKey: string }) {
      return send<ConnectIntegrationResult>(
        "POST",
        "/host/integrations/hostaway/connect",
        body,
      );
    },

    listIntegrationProperties(id: string, options?: RequestOptions) {
      return request<ExternalListings>(`/host/integrations/${id}/properties`, options);
    },

    createIntegrationMapping(
      id: string,
      body: { propertyId: string; externalPropertyId: string; externalPropertyName?: string },
    ) {
      return send<PropertyMapping>("POST", `/host/integrations/${id}/mappings`, body);
    },

    deleteIntegrationMapping(id: string, mappingId: string) {
      return send<void>("DELETE", `/host/integrations/${id}/mappings/${mappingId}`, undefined);
    },

    syncIntegration(id: string) {
      return send<{ status: string; queued: boolean }>(
        "POST",
        `/host/integrations/${id}/sync`,
        undefined,
      );
    },

    disconnectIntegration(id: string) {
      return send<void>("DELETE", `/host/integrations/${id}`, undefined);
    },
  };
}
