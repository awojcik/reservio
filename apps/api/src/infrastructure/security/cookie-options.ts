import type { AppEnvironmentName } from "./app-environment";
import { isProductionLike } from "./app-environment";

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: string;
  secure: boolean;
  maxAge: number;
};

/**
 * One definition of how a Rezervio cookie is set.
 *
 * `HttpOnly` always: the frontend never reads a session token, it asks
 * `/api/auth/me`. `Secure` wherever the site is served over TLS — a Secure
 * cookie on plain-HTTP localhost is silently dropped, which would make local
 * development look like a broken login.
 *
 * `SameSite=Lax` rather than `Strict`: the Guest access link arrives by email,
 * and Strict would withhold the cookie on that first cross-site navigation —
 * the Guest would land on their own Booking and be told to sign in. Lax still
 * withholds it from every cross-site POST, which is the case CSRF needs
 * (milestone 11 §18, §19).
 */
export function cookieOptionsFor(
  environment: AppEnvironmentName,
  maxAge: number,
  path = "/",
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path,
    secure: isProductionLike(environment),
    maxAge,
  };
}
