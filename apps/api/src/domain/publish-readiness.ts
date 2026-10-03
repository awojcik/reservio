/**
 * The backend is the single source of truth for what "ready to publish" means
 * (milestone 02 §39). The Host editor renders these codes; it does not decide
 * them, and publish re-runs the same check server-side.
 */
export const PUBLISH_REQUIREMENTS = [
  "TITLE",
  "DESCRIPTION",
  "PROPERTY_TYPE",
  "LOCATION",
  "CAPACITY",
  "PRICE",
  "MINIMUM_IMAGES",
] as const;

export type PublishRequirement = (typeof PUBLISH_REQUIREMENTS)[number];

export const MINIMUM_IMAGES = 3;
export const TITLE_MIN = 5;
export const TITLE_MAX = 120;
export const DESCRIPTION_MIN = 80;
export const DESCRIPTION_MAX = 5000;

const CURRENCIES = new Set(["PLN", "EUR", "USD", "GBP"]);
const PROPERTY_TYPES = new Set(["APARTMENT", "HOUSE", "VILLA", "STUDIO"]);

export type PublishCandidate = {
  title: string;
  description: string | null;
  propertyType: string;
  countryCode: string;
  city: string;
  district: string;
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
  maxGuests: number;
  beds: number;
  bathrooms: number;
  baseDailyRateAmountMinor: number;
  currency: string;
  imageCount: number;
};

export type PublishReadiness = {
  ready: boolean;
  missing: PublishRequirement[];
};

export function evaluatePublishReadiness(property: PublishCandidate): PublishReadiness {
  const missing: PublishRequirement[] = [];

  const title = property.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) missing.push("TITLE");

  const description = property.description?.trim() ?? "";
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    missing.push("DESCRIPTION");
  }

  if (!PROPERTY_TYPES.has(property.propertyType)) missing.push("PROPERTY_TYPE");

  // District joins the location requirement because the public Listing shows
  // "city, district" — publishing without it would leave a visible gap.
  const locationComplete =
    property.countryCode.trim().length > 0 &&
    property.city.trim().length > 0 &&
    property.district.trim().length > 0 &&
    property.timeZone.trim().length > 0 &&
    property.latitude !== null &&
    property.longitude !== null;
  if (!locationComplete) missing.push("LOCATION");

  if (property.maxGuests < 1 || property.beds < 1 || property.bathrooms < 1) {
    missing.push("CAPACITY");
  }

  // A CleaningFee of 0 is legitimate; a DailyRate of 0 is not a price.
  if (property.baseDailyRateAmountMinor <= 0 || !CURRENCIES.has(property.currency)) {
    missing.push("PRICE");
  }

  if (property.imageCount < MINIMUM_IMAGES) missing.push("MINIMUM_IMAGES");

  return { ready: missing.length === 0, missing };
}
