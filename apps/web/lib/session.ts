import "server-only";

import { redirect } from "next/navigation";

import { ApiError, type AuthSession } from "@rezervio/api-client";

import { createSessionApiClient } from "./api-server";

/**
 * The signed-in identity, or null. One User may be a Guest, a Host, or both —
 * `host` being null is a normal answer, not an error (milestone 06 §7).
 */
export async function loadIdentity(): Promise<AuthSession | null> {
  const client = await createSessionApiClient();
  try {
    return await client.me({ cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}

/** Guard for the account area; sends the visitor back here after signing in. */
export async function requireUser(returnTo: string): Promise<AuthSession> {
  const identity = await loadIdentity();
  if (!identity) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  return identity;
}

/** A friendly name for greetings, falling back to the email local part. */
export function displayNameFor(identity: AuthSession): string {
  const { firstName, lastName, email } = identity.user;
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  return full || email.split("@")[0];
}
