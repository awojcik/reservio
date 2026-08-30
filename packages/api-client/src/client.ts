import type {
  AmenityOption,
  Profile,
  RegisterHostBody,
  Trip,
  TripsPage,
  UpdateProfileBody,
  Booking,
  CreateBookingBody,
  HostBooking,
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

    listHostBookings(
      params: { status?: string; propertyId?: string } = {},
      options?: RequestOptions,
    ) {
      return request<HostBooking[]>(`/host/bookings${toQueryString(params)}`, options);
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
  };
}
