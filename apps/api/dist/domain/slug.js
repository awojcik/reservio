"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.uniqueSlug = uniqueSlug;
const TRANSLITERATIONS = {
    ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
};
function slugify(...parts) {
    const source = parts
        .filter((part) => Boolean(part && part.trim()))
        .join(" ")
        .toLowerCase()
        .replace(/[ąćęłńóśźż]/g, (char) => TRANSLITERATIONS[char] ?? char)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
    const slug = source
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "");
    return slug || "obiekt";
}
async function uniqueSlug(base, isTaken) {
    if (!(await isTaken(base)))
        return base;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${base}-${suffix}`;
        if (!(await isTaken(candidate)))
            return candidate;
    }
    throw new Error(`Nie udało się wygenerować unikalnego slug dla: ${base}`);
}
//# sourceMappingURL=slug.js.map