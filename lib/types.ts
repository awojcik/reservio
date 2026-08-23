export type PropertyType = "apartment" | "house" | "villa" | "studio";

export type Amenity =
  | "pool"
  | "parking"
  | "wifi"
  | "kitchen"
  | "washer"
  | "airConditioning"
  | "balcony"
  | "terrace"
  | "sauna"
  | "seaView"
  | "petFriendly"
  | "workspace"
  | "elevator"
  | "fireplace"
  | "bbq";

export type Property = {
  id: string;
  slug: string;
  title: string;

  city: string;
  district: string;

  latitude: number;
  longitude: number;

  images: string[];

  /** 0–10 scale, e.g. 9.4 */
  rating: number;
  reviewCount: number;

  bedrooms: number;
  beds: number;
  bathrooms: number;
  maxGuests: number;

  amenities: Amenity[];

  /** Meters to the nearest beach. Absent for inland properties. */
  distanceToBeach?: number;

  pricePerNight: number;
  cleaningFee: number;

  /**
   * Average nightly price of the same place on large OTAs.
   * The difference against `pricePerNight` is what the guest saves on Rezervio.
   */
  marketPrice: number;

  propertyType: PropertyType;

  description: string;
};

export type PriceBreakdown = {
  nights: number;
  accommodationPrice: number;
  cleaningFee: number;
  totalPrice: number;
  /** Total price on other portals minus the Rezervio total. 0 when there is no saving. */
  saving: number;
  marketTotalPrice: number;
};

export type SortOption =
  | "recommended"
  | "price-asc"
  | "rating-desc"
  | "beach-asc"
  | "best-value";

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** The full, URL-serialisable state of the search experience. */
export type SearchQuery = {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  propertyTypes: PropertyType[];
  minBedrooms: number;
  pool: boolean;
  parking: boolean;
  nearBeach: boolean;
  minRating: number;
  maxPrice: number | null;
  amenities: Amenity[];
  sort: SortOption;
  bounds: MapBounds | null;
};
