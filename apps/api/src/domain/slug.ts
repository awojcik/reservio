/**
 * Slug is the public routing identity (domain language §8). Built from the
 * title and city so a link reads like the Listing it points at:
 *
 *   "Apartament nad morzem" + "Gdańsk" -> apartament-nad-morzem-gdansk
 */
const TRANSLITERATIONS: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
};

export function slugify(...parts: (string | null | undefined)[]): string {
  const source = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => TRANSLITERATIONS[char] ?? char)
    // Strip the remaining diacritics the table above does not cover.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const slug = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug || "obiekt";
}

/**
 * Appends `-2`, `-3`, … until the slug is free. The caller supplies the
 * lookup, so this stays a pure naming rule with no database dependency.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error(`Nie udało się wygenerować unikalnego slug dla: ${base}`);
}
