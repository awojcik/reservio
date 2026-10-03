import "server-only";

import { redirect } from "next/navigation";

import { ApiError, type AdminStripeStatus } from "@rezervio/api-client";

import { createSessionApiClient } from "./api-server";

export type AdminAccess =
  | { allowed: true; stripe: AdminStripeStatus }
  | { allowed: false };

/**
 * The admin area's guard.
 *
 * Deliberately asks the **API** whether this session may be here, rather than
 * reading a role out of the session document: the backend is where the rule
 * lives, and a frontend that decided for itself would be a second, weaker copy
 * of it. A 403 from the API is the answer (milestone 11 §4).
 *
 * The call doubles as the header's data — the Stripe mode badge — so guarding
 * costs no extra round trip.
 */
export async function requireAdmin(returnTo = "/admin"): Promise<AdminAccess> {
  const client = await createSessionApiClient();

  try {
    return { allowed: true, stripe: await client.getAdminStripeStatus({ cache: "no-store" }) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof ApiError && error.status === 403) {
      return { allowed: false };
    }
    throw error;
  }
}
