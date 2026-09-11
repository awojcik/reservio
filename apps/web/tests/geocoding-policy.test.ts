import { describe, expect, it } from "vitest";

import {
  DEBOUNCE_MS,
  fingerprint,
  isAskable,
  shouldApplyResult,
  shouldLookUp,
} from "@/components/host/useGeocodedLocation";
import { COUNTRY_OPTIONS, isKnownCountry } from "@/lib/host";

const address = (overrides: Partial<Parameters<typeof fingerprint>[0]> = {}) => ({
  addressLine1: "ul. Jelitkowska 8",
  postalCode: "80-342",
  city: "Gdańsk",
  countryCode: "PL",
  ...overrides,
});

/**
 * When Rezervio is allowed to ask a geocoder anything, and when a found point
 * is allowed to move the marker. Both rules are pure so they can be tested
 * without a DOM — what matters is the policy, not the effect that runs it
 * (§7).
 */
describe("when to ask", () => {
  it("waits long enough that typing a street is not a request per letter", () => {
    // Roughly a pause in typing, not a keystroke.
    expect(DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
  });

  it("needs a city and a country before there is anything to ask", () => {
    expect(isAskable(address())).toBe(true);
    expect(isAskable(address({ city: "" }))).toBe(false);
    expect(isAskable(address({ city: "G" }))).toBe(false);
    expect(isAskable(address({ countryCode: "" }))).toBe(false);
    expect(isAskable(address({ countryCode: "POL" }))).toBe(false);
  });

  it("asks for an address nobody has asked about", () => {
    expect(shouldLookUp(address(), null)).toBe(true);
  });

  it("does not ask twice about the same address", () => {
    const asked = fingerprint(address());
    expect(shouldLookUp(address(), asked)).toBe(false);
  });

  /** Reopening the editor or fixing capitalisation is not a new question. */
  it("treats case and spacing as the same address", () => {
    const asked = fingerprint(address());

    expect(shouldLookUp(address({ city: "  GDAŃSK " }), asked)).toBe(false);
    expect(shouldLookUp(address({ addressLine1: "UL.  Jelitkowska  8" }), asked)).toBe(false);
  });

  it("asks again once the address genuinely changes", () => {
    const asked = fingerprint(address());

    expect(shouldLookUp(address({ addressLine1: "ul. Zdrojowa 4" }), asked)).toBe(true);
    expect(shouldLookUp(address({ city: "Sopot" }), asked)).toBe(true);
    expect(shouldLookUp(address({ postalCode: "80-515" }), asked)).toBe(true);
  });
});

describe("when a result may move the marker", () => {
  /** A Property with no point yet: the geocoder is proposing one. */
  it("places the first point automatically", () => {
    expect(shouldApplyResult(false, false)).toBe(true);
  });

  /**
   * The Host dragged the marker onto the right building. A later automatic
   * lookup must not quietly undo that — they are closer to the building than
   * any geocoder (§1).
   */
  it("never overwrites an existing point automatically", () => {
    expect(shouldApplyResult(false, true)).toBe(false);
  });

  /** Unless they ask for it: "find it again" is a deliberate act. */
  it("overwrites when the Host explicitly asks", () => {
    expect(shouldApplyResult(true, true)).toBe(true);
    expect(shouldApplyResult(true, false)).toBe(true);
  });
});

/**
 * The country a Host can pick.
 *
 * A Property whose country is not a country cannot be geocoded at all: the
 * provider filters by country code, so the address comes back empty and the
 * Host is told, wrongly, that their street does not exist. The editor now
 * offers a list instead of a two-character box, and this is the rule that
 * decides whether a stored code can be offered back.
 */
describe("the country of a Property", () => {
  it("recognises the codes the editor offers", () => {
    for (const option of COUNTRY_OPTIONS) {
      expect(isKnownCountry(option.value)).toBe(true);
    }
  });

  /** "PO" is "Polska" truncated to two characters — the original bug. */
  it("rejects a code that is not a country", () => {
    for (const code of ["PO", "XX", "POL", ""]) {
      expect(isKnownCountry(code)).toBe(false);
    }
  });

  it("ignores case and padding, which do not change a country", () => {
    expect(isKnownCountry(" pl ")).toBe(true);
  });

  /** Poland first: it is where nearly every Rezervio Property is. */
  it("offers Poland first", () => {
    expect(COUNTRY_OPTIONS[0].value).toBe("PL");
  });
});
