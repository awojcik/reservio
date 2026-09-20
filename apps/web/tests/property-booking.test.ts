import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * The booking box on the Listing.
 *
 * Source-level checks, like the map ones: what matters is not how the box
 * looks but where its numbers come from and which button it is willing to
 * show. A total multiplied in the browser, or a live "Zarezerwuj" over a
 * stay nobody checked, is exactly what these catch.
 */

const box = source("components/property/BookingBox.tsx");
const picker = source("components/property/StayPicker.tsx");

describe("dates can be chosen without leaving the page", () => {
  it("renders the picker and the guest steppers in the box itself", () => {
    expect(box).toContain('"use client"');
    expect(box).toContain("<StayPicker");
    expect(box).toContain("<Stepper");
  });

  it("opens with no stay and offers the picker as the only action", () => {
    expect(box).toContain('if (!initialCheckIn || !initialCheckOut) return { status: "idle" };');
    expect(box).toMatch(/quote\.status === "idle"[\s\S]{0,400}Wybierz daty/);
  });

  it("seeds itself from the answer the server already gave for these dates", () => {
    expect(box).toContain('if (property.available === false) return { status: "unavailable" };');
    expect(box).toContain('return { status: "available", price: property.price };');
  });
});

describe("the calendar knows what is taken", () => {
  it("asks the public availability endpoint, in the Property's own window", () => {
    expect(box).toContain("getPublicAvailability(slug, calendarRange");
    expect(box).toContain("todayInTimeZone(property.timeZone)");
  });

  it("disables days through the shared half-open helpers", () => {
    expect(picker).toContain("canCheckIn(");
    expect(picker).toContain("canCheckOut(");
    expect(picker).toMatch(/disabled=\{!selectable\}/);
  });

  it("keeps working when the taken dates cannot be fetched", () => {
    // The stay is verified server-side either way; a picker that refuses to
    // open would be the worse failure.
    expect(box).toContain('setRangesState("failed")');
    expect(picker).toContain("unknownAvailability");
  });

  it("never treats itself as the source of truth", () => {
    expect(picker).toMatch(/not the source of truth/i);
    expect(box).toMatch(/server/i);
  });
});

describe("the price comes from the server", () => {
  it("renders the API's PriceQuote for the chosen stay", () => {
    expect(box).toContain("quote.price.accommodationAmountMinor");
    expect(box).toContain("quote.price.cleaningFeeAmountMinor");
    expect(box).toContain("quote.price.totalAmountMinor");
    expect(box).toContain("getProperty(slug, { checkIn: next.checkIn, checkOut: next.checkOut })");
  });

  it("does no arithmetic of its own on money", () => {
    expect(box).not.toMatch(/AmountMinor\s*\*/);
    expect(box).not.toMatch(/\*\s*nights/);
  });
});

describe("the call to action says what is true", () => {
  it("announces the check while it is running", () => {
    expect(box).toMatch(/quote\.status === "checking"[\s\S]{0,300}Sprawdzamy dostępność/);
  });

  it("offers other dates instead of a dead button when the stay is taken", () => {
    expect(box).toMatch(/showUnavailable \?[\s\S]{0,500}Termin niedostępny/);
    expect(box).toMatch(/Wybierz inne daty/);
  });

  it("lets the fresh calendar take back a stay the cached page called free", () => {
    // The page is cached for a minute; the calendar is fetched now. It may
    // only tighten the answer, never loosen it.
    expect(box).toContain("const takenByCalendar =");
    expect(box).toContain("!isStayAvailable(stay.checkIn, stay.checkOut, ranges)");
    expect(box).toContain(
      'quote.status === "unavailable" || (quote.status === "available" && takenByCalendar)',
    );
    // Nothing turns an unavailable stay back into an available one.
    expect(box).not.toMatch(/status:\s*"available"[\s\S]{0,80}takenByCalendar/);
  });

  it("offers a retry on a failed check", () => {
    expect(box).toMatch(/quote\.status === "error"[\s\S]{0,500}Spróbuj ponownie/);
    expect(box).toContain("const retry = () => check(stay);");
  });

  it("links to the booking form only once the stay is available", () => {
    // The Link is the last branch of the chain — every failure state is
    // handled before it, so it cannot render over an unchecked stay.
    const chain = box.slice(box.indexOf('quote.status === "idle"'));
    expect(chain.indexOf("bookingHref")).toBeGreaterThan(chain.indexOf("showUnavailable ?"));
    expect(chain.indexOf("bookingHref")).toBeGreaterThan(chain.indexOf('quote.status === "error"'));
  });

  it("stops at the Property's capacity rather than letting the API refuse it", () => {
    expect(box).toContain("const overCapacity = totalGuests > property.maxGuests;");
  });
});

describe("the chosen stay reaches the rest of the flow", () => {
  it("writes it into the URL instead of keeping a private copy", () => {
    expect(box).toContain("window.history.replaceState");
    expect(box).toContain("buildSearchParams({ ...query, ...next })");
  });

  it("carries the whole search into the booking form", () => {
    expect(box).toContain("/booking/${slug}?${buildSearchParams({");
  });
});

describe("the Host preview keeps the static card", () => {
  const preview = source("app/host/(app)/properties/[id]/preview/page.tsx");
  const view = source("components/property/PropertyDetailView.tsx");

  it("does not mount a picker that has no public availability to read", () => {
    expect(preview).not.toContain("BookingBox");
    expect(view).toContain("{booking ?? (");
  });
});
