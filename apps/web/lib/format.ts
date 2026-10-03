import { format, parseISO } from "date-fns";
import { pl } from "date-fns/locale";

import type { Amenity, PropertyType } from "./types";

const NBSP = "\u00A0"; // non-breaking space

/**
 * 192000 (minor units) -> "1 920 zł", with non-breaking spaces so a price never
 * wraps. Grouping is applied by hand: pl-PL leaves four-digit numbers ungrouped
 * ("1920"), and the total price is too important to read as one blob.
 */
export function formatAmountMinor(amountMinor: number): string {
  const digits = String(Math.round(Math.abs(amountMinor) / 100));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = amountMinor < 0 ? "−" : "";
  return `${sign}${grouped}${NBSP}zł`;
}

export function formatRating(rating: number): string {
  return rating.toFixed(1).replace(".", ",");
}

export function formatDate(date: string | Date): string {
  const value = typeof date === "string" ? parseISO(date) : date;
  return format(value, "d MMM", { locale: pl }).replace(".", "");
}

export function formatDateRange(checkIn: string, checkOut: string): string {
  return `${formatDate(checkIn)} — ${formatDate(checkOut)}`;
}

export function formatLongDateRange(checkIn: string, checkOut: string): string {
  const from = parseISO(checkIn);
  const to = parseISO(checkOut);
  const sameMonth = from.getMonth() === to.getMonth();
  const fromLabel = sameMonth
    ? format(from, "d", { locale: pl })
    : format(from, "d MMMM", { locale: pl });
  return `${fromLabel} — ${format(to, "d MMMM", { locale: pl })}`;
}

function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function formatNights(count: number): string {
  return `${count} ${plural(count, "noc", "noce", "nocy")}`;
}

export function formatGuests(adults: number, children: number): string {
  const parts = [
    `${adults} ${plural(adults, "dorosły", "dorosłych", "dorosłych")}`,
  ];
  if (children > 0) {
    parts.push(`${children} ${plural(children, "dziecko", "dzieci", "dzieci")}`);
  }
  return parts.join(", ");
}

export function formatGuestCapacity(count: number): string {
  return `${count} ${plural(count, "osoba", "osoby", "osób")}`;
}

export function formatBedrooms(count: number): string {
  return `${count} ${plural(count, "sypialnia", "sypialnie", "sypialni")}`;
}

export function formatBeds(count: number): string {
  return `${count} ${plural(count, "łóżko", "łóżka", "łóżek")}`;
}

export function formatBathrooms(count: number): string {
  return `${count} ${plural(count, "łazienka", "łazienki", "łazienek")}`;
}

export function formatResultCount(count: number): string {
  return `${count} ${plural(count, "miejsce", "miejsca", "miejsc")}`;
}

export function formatReviews(count: number): string {
  return `${count} ${plural(count, "opinia", "opinie", "opinii")}`;
}

/** Locative forms for the destinations we ship; anything else stays quoted. */
const LOCATIVE: Record<string, string> = {
  gdansk: "w Gdańsku",
  gdynia: "w Gdyni",
  sopot: "w Sopocie",
  brzezno: "w Brzeźnie",
  jelitkowo: "w Jelitkowie",
  oliwa: "w Oliwie",
  wrzeszcz: "we Wrzeszczu",
  srodmiescie: "w Śródmieściu",
  krakow: "w Krakowie",
  zakopane: "w Zakopanem",
};

export function formatDestinationPhrase(destination: string): string {
  const trimmed = destination.trim();
  if (!trimmed) return "";

  const key = trimmed
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  return LOCATIVE[key] ?? `dla „${trimmed}”`;
}

export function formatBeachDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1).replace(".", ",")} km do plaży`;
  }
  return `${meters} m do plaży`;
}

export const AMENITY_LABELS: Record<Amenity, string> = {
  POOL: "Basen",
  PARKING: "Parking",
  WIFI: "Wi-Fi",
  KITCHEN: "Kuchnia",
  WASHING_MACHINE: "Pralka",
  AIR_CONDITIONING: "Klimatyzacja",
  BALCONY: "Balkon",
  TERRACE: "Taras",
  SAUNA: "Sauna",
  SEA_VIEW: "Widok na morze",
  PET_FRIENDLY: "Zwierzęta OK",
  WORKSPACE: "Miejsce do pracy",
  ELEVATOR: "Winda",
  FIREPLACE: "Kominek",
  BBQ: "Grill",
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: "Apartament",
  house: "Dom",
  villa: "Willa",
  studio: "Studio",
};
