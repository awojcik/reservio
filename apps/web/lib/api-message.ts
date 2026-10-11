import { ApiError } from "@rezervio/api-client";

/**
 * The message the API wrote, when it is one worth showing a person.
 *
 * `ApiError.message` is about the request ("Żądanie do API nie powiodło
 * się (400)"), not about what went wrong; the sentence a Host can act on is in
 * the body Nest sends. Without this, a validation error the API states
 * precisely — the file is not an image, the photo is over 10 MB — reaches the
 * screen as a generic failure, and the Host has no way to tell a rejected
 * file from a broken upload.
 *
 * Only for 4xx. A 500 means the sentence is about us, not about anything the
 * Host did, and `class-validator` sends an array when several fields fail.
 */
export function clientErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status < 400 || error.status >= 500) return null;

  const body = error.body;
  if (typeof body !== "object" || body === null) return null;

  const message = (body as { message?: unknown }).message;

  if (typeof message === "string" && message.trim() !== "") return message;
  if (Array.isArray(message)) {
    const sentences = message.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
    );
    if (sentences.length > 0) return sentences.join(" ");
  }

  return null;
}
