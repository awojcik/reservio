import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * The correlation id for the request being served, reachable from anywhere
 * without threading it through every signature.
 *
 * Structured logs are only useful if a line written deep inside a service can
 * be tied to the request that caused it (milestone 11 §13). `AsyncLocalStorage`
 * is the one mechanism that survives every `await` without a parameter.
 */
export type RequestContext = {
  requestId: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = "x-request-id";

/** A caller-supplied id is honoured, so a trace can span web → API. */
export function normaliseRequestId(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return randomUUID();

  // Bounded and boring: this id ends up in log lines and a response header.
  const trimmed = candidate.trim().slice(0, 64);
  return /^[A-Za-z0-9._-]{8,64}$/.test(trimmed) ? trimmed : randomUUID();
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Binds the context to the current execution and everything that follows it.
 *
 * `enterWith` rather than `run` because the caller is a Fastify `onRequest`
 * hook: the handler that needs the id runs long after the hook's own callback
 * has returned, so a callback-scoped `run` would not reach it.
 */
export function enterRequestContext(context: RequestContext): void {
  storage.enterWith(context);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Undefined outside a request — a worker has no correlation id to borrow. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Set once the session has been resolved, so later lines carry the actor. */
export function setContextUserId(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}
