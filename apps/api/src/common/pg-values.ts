/**
 * `db.execute` runs outside Drizzle's column mappers, so postgres.js hands the
 * rows back the way the wire format has them: a `timestamptz` arrives as
 * `"2026-08-30 12:00:29.889+00"`, not as a `Date`. Read models that need one
 * batched query per screen are the main users of raw SQL, so the conversion
 * lives here instead of being repeated at every call site.
 */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;

  const text = String(value).replace(" ", "T");
  // Postgres writes a bare-hour offset ("+00"); the Date parser wants "+00:00".
  const normalised = /[+-]\d{2}$/.test(text)
    ? `${text}:00`
    : /(Z|[+-]\d{2}:?\d{2})$/.test(text)
      ? text
      : `${text}Z`;

  return new Date(normalised);
}

export function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

export function toIso(value: unknown): string {
  return toDate(value).toISOString();
}

export function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}
