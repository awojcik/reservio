import type { PropertyStatus } from "@rezervio/api-client";

/**
 * Presentation labels for the Host area. Domain values stay English and stable;
 * only what a person reads is Polish (domain language §2).
 */
export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Szkic",
  IN_REVIEW: "W weryfikacji",
  PUBLISHED: "Opublikowany",
  SUSPENDED: "Wycofany",
  ARCHIVED: "Zarchiwizowany",
};

/** Explains each publishReadiness code the backend can return. */
export const PUBLISH_REQUIREMENT_LABELS: Record<string, string> = {
  TITLE: "Tytuł od 5 do 120 znaków",
  DESCRIPTION: "Opis od 80 do 5000 znaków",
  PROPERTY_TYPE: "Typ obiektu",
  LOCATION: "Miasto, dzielnica, kraj i punkt na mapie",
  CAPACITY: "Co najmniej 1 gość, 1 łóżko i 1 łazienka",
  PRICE: "Cena za noc większa niż 0",
  MINIMUM_IMAGES: "Minimum 3 zdjęcia",
};

export const PROPERTY_TYPE_OPTIONS = [
  { value: "APARTMENT", label: "Apartament" },
  { value: "HOUSE", label: "Dom" },
  { value: "VILLA", label: "Willa" },
  { value: "STUDIO", label: "Studio" },
] as const;

/** Status drives which lifecycle actions make sense. */
export function canPublish(status: PropertyStatus): boolean {
  return status !== "PUBLISHED" && status !== "ARCHIVED";
}

export function canUnpublish(status: PropertyStatus): boolean {
  return status === "PUBLISHED";
}

export function canArchive(status: PropertyStatus): boolean {
  return status !== "ARCHIVED";
}

/**
 * Money crosses the UI boundary here. The API speaks minor units and an ISO
 * code; the Host types złoty. Rounding happens once, on the way in.
 */
export function minorToMajor(amountMinor: number): string {
  return String(Math.round(amountMinor) / 100);
}

export function majorToMinor(value: string): number {
  const normalised = value.replace(",", ".").trim();
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

/**
 * The country of a Property, chosen rather than typed.
 *
 * A two-character text box looked harmless and was not: "Polska" typed into it
 * silently became "PO", which is not a country. It saved without complaint and
 * then broke geocoding, because the provider filters by country code — so the
 * address was reported as "not found" and the Property never got a point on
 * the map.
 *
 * The list is deliberately short: the countries Rezervio's Hosts actually let
 * places in. The API accepts any ISO-3166-1 alpha-2 code, so extending this is
 * one line and needs no backend change.
 */
export const COUNTRY_OPTIONS = [
  { value: "PL", label: "Polska" },
  { value: "DE", label: "Niemcy" },
  { value: "CZ", label: "Czechy" },
  { value: "SK", label: "Słowacja" },
  { value: "LT", label: "Litwa" },
  { value: "AT", label: "Austria" },
  { value: "IT", label: "Włochy" },
  { value: "ES", label: "Hiszpania" },
  { value: "PT", label: "Portugalia" },
  { value: "FR", label: "Francja" },
  { value: "HR", label: "Chorwacja" },
  { value: "GR", label: "Grecja" },
] as const;

/** Whether a stored code is one this editor can offer back. */
export function isKnownCountry(code: string): boolean {
  return COUNTRY_OPTIONS.some((option) => option.value === code.trim().toUpperCase());
}
