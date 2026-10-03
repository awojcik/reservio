import { describe, expect, it } from "vitest";

import {
  evaluatePublishReadiness,
  type PublishCandidate,
} from "../src/domain/publish-readiness";
import { slugify, uniqueSlug } from "../src/domain/slug";

/** Pure domain rules — no database, no HTTP. */
const COMPLETE: PublishCandidate = {
  title: "Apartament nad morzem",
  description: "x".repeat(120),
  propertyType: "APARTMENT",
  countryCode: "PL",
  city: "Gdańsk",
  district: "Brzeźno",
  timeZone: "Europe/Warsaw",
  latitude: 54.4,
  longitude: 18.61,
  maxGuests: 4,
  beds: 3,
  bathrooms: 1,
  baseDailyRateAmountMinor: 45_000,
  currency: "PLN",
  imageCount: 3,
};

describe("publish readiness", () => {
  it("accepts a complete Property", () => {
    expect(evaluatePublishReadiness(COMPLETE)).toEqual({ ready: true, missing: [] });
  });

  it("reports a description shorter than 80 characters", () => {
    const result = evaluatePublishReadiness({ ...COMPLETE, description: "Za krótki opis" });
    expect(result.missing).toContain("DESCRIPTION");
  });

  it("treats a missing point on the map as an incomplete location", () => {
    const result = evaluatePublishReadiness({ ...COMPLETE, latitude: null });
    expect(result.missing).toContain("LOCATION");
  });

  it("requires at least one bed and one bathroom", () => {
    expect(evaluatePublishReadiness({ ...COMPLETE, beds: 0 }).missing).toContain("CAPACITY");
    expect(evaluatePublishReadiness({ ...COMPLETE, bathrooms: 0 }).missing).toContain(
      "CAPACITY",
    );
  });

  it("accepts a CleaningFee of zero but not a DailyRate of zero", () => {
    expect(
      evaluatePublishReadiness({ ...COMPLETE, baseDailyRateAmountMinor: 0 }).missing,
    ).toContain("PRICE");
  });

  it("requires three images", () => {
    expect(evaluatePublishReadiness({ ...COMPLETE, imageCount: 2 }).missing).toContain(
      "MINIMUM_IMAGES",
    );
  });

  it("does not require Amenity", () => {
    expect(evaluatePublishReadiness(COMPLETE).ready).toBe(true);
  });
});

describe("slug", () => {
  it("transliterates Polish characters", () => {
    expect(slugify("Apartament nad morzem", "Gdańsk")).toBe("apartament-nad-morzem-gdansk");
    expect(slugify("Willa Źródlana", "Świnoujście")).toBe("willa-zrodlana-swinoujscie");
  });

  it("falls back when there is nothing to slugify", () => {
    expect(slugify("", "")).toBe("obiekt");
    expect(slugify("!!!")).toBe("obiekt");
  });

  it("appends a counter on collision", async () => {
    const taken = new Set(["apartament", "apartament-2"]);
    await expect(uniqueSlug("apartament", async (c) => taken.has(c))).resolves.toBe(
      "apartament-3",
    );
  });
});
