import "server-only";

import { createApiClient } from "@rezervio/api-client";
import { cookies } from "next/headers";

/**
 * Server-side API clients. Kept apart from `lib/api.ts` because that module is
 * bundled into Client Components, and `next/headers` exists only on the server.
 *
 * Next.js on the server can reach the API on an internal address, which keeps
 * it working even when the API is not exposed publicly.
 */
const INTERNAL_API_URL =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3001/api";

/** Anonymous client for public pages. */
export function createServerApiClient() {
  return createApiClient(INTERNAL_API_URL);
}

/**
 * Acts as the signed-in User. Server Components cannot rely on `credentials`,
 * so the incoming cookies are forwarded explicitly.
 */
export async function createSessionApiClient() {
  const store = await cookies();
  const header = store
    .getAll()
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  return createApiClient(INTERNAL_API_URL, header ? { headers: { cookie: header } } : {});
}
