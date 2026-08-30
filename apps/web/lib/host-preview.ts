import type { HostProperty, PropertyDetail } from "@rezervio/api-client";

/**
 * Adapts the Host view of a Property onto the public Listing shape, so the
 * preview can render through exactly the same components a Guest sees.
 *
 * The two DTOs stay separate — this is a deliberate one-way projection, not a
 * claim that they are the same contract. A DRAFT is missing things a published
 * Listing always has, and those gaps are filled with honest neutral values
 * rather than invented ones: no rating, no reviews, no MarketPrice, therefore
 * no Saving.
 */
export function toPreviewDetail(property: HostProperty): PropertyDetail {
  const nights = 1;
  const accommodation = property.pricing.baseDailyRateAmountMinor * nights;
  const cleaning = property.pricing.cleaningFeeAmountMinor;

  return {
    id: property.id,
    slug: property.slug,
    title: property.title,
    description: property.description ?? "Opis pojawi się tutaj, gdy go uzupełnisz.",
    city: property.address.city || "—",
    district: property.address.district || "—",
    countryCode: property.address.countryCode,
    timeZone: property.address.timeZone,
    // A Property without a point on the map has nothing to show; the map falls
    // back to the Tri-City centre rather than pretending to know the address.
    latitude: property.address.latitude ?? 54.3925,
    longitude: property.address.longitude ?? 18.6135,
    coverImage: property.images[0]
      ? {
          url: property.images[0].url,
          altText: property.images[0].altText,
          position: property.images[0].position,
        }
      : null,
    rating: 0,
    reviewCount: 0,
    bedrooms: property.capacity.bedrooms,
    beds: property.capacity.beds,
    bathrooms: property.capacity.bathrooms,
    maxGuests: property.capacity.maxGuests,
    propertyType: property.propertyType,
    amenities: property.amenities,
    distanceToBeachMeters: null,
    images: property.images.map((image) => ({
      url: image.url,
      altText: image.altText,
      position: image.position,
    })),
    baseDailyRateAmountMinor: property.pricing.baseDailyRateAmountMinor,
    // The preview shows the Listing, not a specific Stay, so there is no Stay
    // to be available for.
    available: null,
    bookingMode: property.bookingMode as "REQUEST_TO_BOOK",
    price: {
      nights,
      accommodationAmountMinor: accommodation,
      cleaningFeeAmountMinor: cleaning,
      totalAmountMinor: accommodation + cleaning,
      marketAmountMinor: null,
      savingAmountMinor: null,
      currency: property.pricing.currency,
    },
  };
}
