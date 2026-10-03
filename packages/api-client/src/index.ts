/**
 * Typed fetch client for the Rezervio API.
 *
 * Types come from `schema.d.ts`, generated out of the API's own OpenAPI
 * document (`pnpm api:types` with the API running) — the backend stays the
 * single source of truth and nothing backend-side is imported here.
 */
export * from "./types";
export { ApiError, createApiClient, type ApiClient } from "./client";
