/**
 * What went wrong at a provider, in terms the domain can act on.
 *
 * The distinction that matters is `retryable`: a rate limit or a gateway
 * timeout will probably work in a minute, while rejected credentials will
 * still be rejected in an hour. Retrying the second forever is how an
 * integration turns into a denial-of-service against its own partner
 * (milestone 12 §30).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    /** HTTP status, when the failure came from a response at all. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * The provider is reachable and the request was fine — we are simply not
 * admitted to the programme that would let it succeed.
 *
 * Deliberately its own error: a partner-access gap is a business step nobody
 * has taken, and reporting it as a technical failure would send somebody
 * debugging code that is already correct (milestone 12 §18, §21).
 */
export class PartnerAccessRequiredError extends ProviderError {
  constructor(message: string) {
    super(message, "PARTNER_ACCESS_REQUIRED", false);
    this.name = "PartnerAccessRequiredError";
  }
}
