import "server-only";

import { redirect } from "next/navigation";

import { ApiError, type AuthSession } from "@rezervio/api-client";

import { createSessionApiClient } from "./api-server";

/** Null when there is no live session — never throws for the anonymous case. */
export async function loadSession(): Promise<AuthSession | null> {
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

/**
 * Guard for every /host route that is not login or register. The backend
 * enforces this too — this only spares the Host a pointless round trip to a
 * page they cannot use.
 */
export async function requireHost(): Promise<NonNullable<AuthSession["host"]>> {
  const session = await loadSession();
  if (!session?.host) redirect("/host/login");
  return session.host;
}
