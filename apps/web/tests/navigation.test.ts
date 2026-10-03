import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "app");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every `page.tsx` under `app/`, as a route pattern. */
function routePatterns(): string[] {
  const patterns: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const segments = relative(APP, dir)
          .split(sep)
          .filter((segment) => segment !== "" && !segment.startsWith("("));
        patterns.push(`/${segments.join("/")}`);
      }
    }
  };

  walk(APP);
  return patterns;
}

const PATTERNS = routePatterns();

/** Does any route pattern serve this concrete path? */
function resolves(path: string): boolean {
  const wanted = path.split("?")[0].split("/").filter(Boolean);

  return PATTERNS.some((pattern) => {
    const segments = pattern.split("/").filter(Boolean);
    if (segments.length !== wanted.length) return false;
    return segments.every(
      (segment, index) => segment.startsWith("[") || segment === wanted[index],
    );
  });
}

/**
 * Nothing in the two main journeys leads nowhere.
 *
 * These are route-level checks rather than rendered navigation: a link to a
 * path the App Router does not serve is a 404 no matter how the page renders
 * it, and that is the failure worth catching in a unit test.
 */

describe("the Guest journey resolves end to end", () => {
  const JOURNEY = [
    "/",
    "/search",
    "/property/baltic-loft-brzezno",
    "/booking/baltic-loft-brzezno",
    "/booking/status/RZV-7KD2M9QP",
    "/account",
    "/account/trips",
    "/account/trips/RZV-7KD2M9QP",
    "/account/profile",
    "/login",
    "/register",
  ];

  it.each(JOURNEY)("%s is served", (path) => {
    expect(resolves(path)).toBe(true);
  });
});

describe("the Host journey resolves end to end", () => {
  const JOURNEY = [
    "/host",
    "/host/login",
    "/host/register",
    "/host/properties",
    "/host/properties/new",
    "/host/properties/8f2f1d2a-0000-4000-8000-000000000000",
    "/host/properties/8f2f1d2a-0000-4000-8000-000000000000/calendar",
    "/host/properties/8f2f1d2a-0000-4000-8000-000000000000/preview",
    "/host/calendar",
    "/host/bookings",
    "/host/bookings/8f2f1d2a-0000-4000-8000-000000000000",
    "/host/payments",
    "/host/integrations",
    "/host/integrations/hostaway",
  ];

  it.each(JOURNEY)("%s is served", (path) => {
    expect(resolves(path)).toBe(true);
  });
});

describe("every internal link points at a route that exists", () => {
  /** Literal `href="/…"` across the app — the links that cannot be typo-proofed
   *  by TypeScript. */
  function literalLinks(dir: string, found = new Set<string>()): Set<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) literalLinks(full, found);
      else if (entry.name.endsWith(".tsx")) {
        const text = readFileSync(full, "utf8");
        for (const match of text.matchAll(/href="(\/[^"]*)"/g)) found.add(match[1]);
      }
    }
    return found;
  }

  const links = [
    ...literalLinks(APP),
    ...literalLinks(join(ROOT, "components")),
  ];

  it("finds links to check", () => {
    expect(links.length).toBeGreaterThan(10);
  });

  it.each(links)("%s resolves", (href) => {
    expect(resolves(href)).toBe(true);
  });

  it("has no placeholder anchors left anywhere", () => {
    expect(links).not.toContain("#");
    for (const dir of [APP, join(ROOT, "components")]) {
      const walk = (path: string): string[] => {
        const out: string[] = [];
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          const full = join(path, entry.name);
          if (entry.isDirectory()) out.push(...walk(full));
          else if (entry.name.endsWith(".tsx")) out.push(readFileSync(full, "utf8"));
        }
        return out;
      };
      for (const text of walk(dir)) expect(text).not.toContain('href="#"');
    }
  });
});

describe("the Host can always get back to the list", () => {
  it("from the create screen", () => {
    // The heading lives in the client component so the link can sit above it
    // and know whether anything has been typed.
    expect(source("app/host/(app)/properties/new/page.tsx")).toContain(
      "<CreatePropertyForm />",
    );
    expect(source("components/host/CreatePropertyForm.tsx")).toContain(
      "<BackToProperties dirty={title.trim().length > 0} />",
    );
  });

  it("from the edit screen", () => {
    expect(source("components/host/PropertyEditor.tsx")).toContain(
      "<BackToProperties dirty={dirty} />",
    );
  });

  it("through one contextual link, not a second navigation bar", () => {
    const back = source("components/host/BackToProperties.tsx");
    expect(back).toContain('href="/host/properties"');
    expect(back).toContain("Wróć do obiektów");
    expect(back).not.toContain("<nav");
  });

  it("asking first when there is unsaved work", () => {
    const back = source("components/host/BackToProperties.tsx");
    // Two exits, two mechanisms: a tab close never reaches a click handler.
    expect(back).toContain('window.addEventListener("beforeunload", warn)');
    expect(back).toContain("event.preventDefault()");
    expect(back).toContain("window.confirm");
  });
});

describe("the Host panel navigation", () => {
  const header = source("components/host/HostHeader.tsx");

  it("marks the current section", () => {
    expect(header).toContain('aria-current={current ? "page" : undefined}');
  });

  it("survives a narrow screen", () => {
    // The desktop row is hidden below `md`; something has to take its place.
    expect(header).toContain("md:hidden");
    expect(header).toContain("overflow-x-auto");
  });

  it("links only to sections that exist", () => {
    const hrefs = [...header.matchAll(/href: "(\/host[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(resolves(href)).toBe(true);
  });
});

describe("the Guest header", () => {
  it("takes the logo home", () => {
    // `Logo` is a link to "/" unless a caller opts out, and the header does not.
    expect(source("components/layout/Logo.tsx")).toContain('<Link href="/"');
    expect(source("components/layout/HeaderShell.tsx")).toContain("<Logo size={23} onDark />");
  });

  it("keeps My Trips reachable on a phone", () => {
    const nav = source("components/account/AccountNav.tsx");
    expect(nav).toContain('href="/account/trips"');
    expect(nav).not.toMatch(/href="\/account\/trips"[\s\S]{0,200}hidden sm:inline-flex/);
  });
});

describe("no screen is a dead end", () => {
  it("a booking form without dates goes back to where dates are chosen", () => {
    const page = source("app/booking/[slug]/page.tsx");
    expect(page).toContain("if (!query.checkIn || !query.checkOut) {");
    expect(page).toContain("redirect(`/property/${slug}");
  });

  it("a finished booking offers My Trips once it belongs to the account", () => {
    const page = source("app/booking/status/[reference]/page.tsx");
    expect(page).toContain("identity && booking.allowedActions.claimed");
    expect(page).toContain("/account/trips/${booking.reference}");
  });

  it("a trip leads to paying, the stay details and the conversation", () => {
    const page = source("app/account/trips/[reference]/page.tsx");
    expect(page).toContain("/booking/status/${trip.reference}");
    expect(page).toContain("trip.allowedActions.canPay");
  });
});
