import { BEACH_RADIUS } from "./search";
import type { PropertyType, SearchQuery } from "./types";

/**
 * Demonstration-only interpreter for the "Opisz czego szukasz" field.
 *
 * There is no model behind it yet — it maps a handful of Polish keywords onto
 * the existing filters, so the product direction is visible and the eventual
 * LLM call can drop in behind the same signature.
 */
export type Interpretation = {
  patch: Partial<SearchQuery>;
  /** Human readable list of what was understood, shown back to the user. */
  matched: string[];
};

const TYPE_KEYWORDS: { type: PropertyType; words: string[]; label: string }[] = [
  { type: "apartment", words: ["apartament", "mieszkan"], label: "apartament" },
  { type: "house", words: ["dom "], label: "dom" },
  { type: "villa", words: ["willa", "wille", "willi"], label: "willa" },
  { type: "studio", words: ["studio", "kawalerk"], label: "studio" },
];

export function interpretQuery(input: string): Interpretation {
  const text = input
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const patch: Partial<SearchQuery> = {};
  const matched: string[] = [];

  if (/basen/.test(text)) {
    patch.pool = true;
    matched.push("basen");
  }

  if (/parking|gara|auto|samochod/.test(text)) {
    patch.parking = true;
    matched.push("parking");
  }

  if (/plaz|morz|nadmorsk/.test(text)) {
    patch.nearBeach = true;
    matched.push(`do ${BEACH_RADIUS} m od plaży`);
  }

  if (/sauna/.test(text)) {
    patch.amenities = [...(patch.amenities ?? []), "sauna"];
    matched.push("sauna");
  }

  if (/zwierz|pies|psem|kot/.test(text)) {
    patch.amenities = [...(patch.amenities ?? []), "petFriendly"];
    matched.push("przyjazne zwierzętom");
  }

  if (/klimatyz/.test(text)) {
    patch.amenities = [...(patch.amenities ?? []), "airConditioning"];
    matched.push("klimatyzacja");
  }

  const types = TYPE_KEYWORDS.filter((entry) =>
    entry.words.some((word) => text.includes(word)),
  );
  if (types.length) {
    patch.propertyTypes = types.map((entry) => entry.type);
    matched.push(types.map((entry) => entry.label).join(", "));
  }

  // "do 3000 zl", "max 2500", "budzet 4 000 zl"
  const budget = text.match(/(?:do|max|maks\w*|budzet)\s*([\d\s]{3,9})\s*(?:zl|pln)?/);
  if (budget) {
    const value = Number(budget[1].replace(/\s/g, ""));
    if (Number.isFinite(value) && value >= 200) {
      patch.maxPrice = value;
      matched.push(`budżet do ${value} zł`);
    }
  }

  // "2+2", "rodzina 2 + 1"
  const family = text.match(/(\d)\s*\+\s*(\d)/);
  if (family) {
    patch.adults = Number(family[1]);
    patch.children = Number(family[2]);
    matched.push(`${family[1]} dorosłych, ${family[2]} dzieci`);
  }

  const bedrooms = text.match(/(\d)\s*sypialn/);
  if (bedrooms) {
    patch.minBedrooms = Number(bedrooms[1]);
    matched.push(`min. ${bedrooms[1]} sypialnie`);
  }

  const rating = text.match(/ocena\s*(?:od|pow\w*)?\s*(\d(?:[.,]\d)?)/);
  if (rating) {
    patch.minRating = Number(rating[1].replace(",", "."));
    matched.push(`ocena od ${rating[1]}`);
  }

  return { patch, matched };
}
