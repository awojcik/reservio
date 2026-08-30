import argon2 from "argon2";
import { eq, inArray } from "drizzle-orm";

import { loadEnv } from "../../config/load-env";
import { createDatabase } from "../connection";
import {
  amenities,
  hosts,
  properties,
  propertyAmenities,
  propertyImages,
  users,
} from "../schema";
import type { PropertyType } from "../schema";
import {
  AMENITY_CODES,
  DEMO_CURRENCY,
  DEMO_HOST_NAME,
  DEMO_PROPERTIES,
} from "./demo-properties";

loadEnv();

/**
 * Fixed so re-seeding updates the same Host instead of piling up duplicates —
 * the whole seed is idempotent and safe to run on every local reset.
 */
const DEMO_HOST_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Development-only credentials, documented in the README. The demo Host
 * predates accounts, so the seed gives it a User — otherwise nobody could sign
 * in and manage the catalogue that ships with the app (milestone 02 §67).
 */
const DEMO_EMAIL = "host@rezervio.local";
const DEMO_PASSWORD = "rezervio-demo-2026";

async function main() {
  const { db, client } = createDatabase();

  try {
    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

    await db
      .insert(users)
      .values({ id: DEMO_USER_ID, email: DEMO_EMAIL, passwordHash })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: DEMO_EMAIL, passwordHash, updatedAt: new Date() },
      });

    await db
      .insert(hosts)
      .values({ id: DEMO_HOST_ID, userId: DEMO_USER_ID, displayName: DEMO_HOST_NAME })
      .onConflictDoUpdate({
        target: hosts.id,
        set: { userId: DEMO_USER_ID, displayName: DEMO_HOST_NAME, updatedAt: new Date() },
      });

    await db
      .insert(amenities)
      .values(AMENITY_CODES.map((code) => ({ code })))
      .onConflictDoNothing({ target: amenities.code });

    const amenityRows = await db
      .select({ id: amenities.id, code: amenities.code })
      .from(amenities);
    const amenityIdByCode = new Map(amenityRows.map((row) => [row.code, row.id]));

    for (const demo of DEMO_PROPERTIES) {
      const [row] = await db
        .insert(properties)
        .values({
          hostId: DEMO_HOST_ID,
          slug: demo.slug,
          title: demo.title,
          description: demo.description,
          propertyType: demo.propertyType as PropertyType,
          status: "PUBLISHED",
          city: demo.city,
          district: demo.district,
          latitude: demo.latitude,
          longitude: demo.longitude,
          maxGuests: demo.maxGuests,
          bedrooms: demo.bedrooms,
          beds: demo.beds,
          bathrooms: demo.bathrooms,
          rating: demo.rating,
          reviewCount: demo.reviewCount,
          distanceToBeachMeters: demo.distanceToBeachMeters,
          baseDailyRateAmountMinor: demo.baseDailyRateAmountMinor,
          cleaningFeeAmountMinor: demo.cleaningFeeAmountMinor,
          marketDailyRateAmountMinor: demo.marketDailyRateAmountMinor,
          currency: DEMO_CURRENCY,
        })
        .onConflictDoUpdate({
          target: properties.slug,
          set: {
            title: demo.title,
            description: demo.description,
            propertyType: demo.propertyType as PropertyType,
            status: "PUBLISHED",
            city: demo.city,
            district: demo.district,
            latitude: demo.latitude,
            longitude: demo.longitude,
            maxGuests: demo.maxGuests,
            bedrooms: demo.bedrooms,
            beds: demo.beds,
            bathrooms: demo.bathrooms,
            rating: demo.rating,
            reviewCount: demo.reviewCount,
            distanceToBeachMeters: demo.distanceToBeachMeters,
            baseDailyRateAmountMinor: demo.baseDailyRateAmountMinor,
            cleaningFeeAmountMinor: demo.cleaningFeeAmountMinor,
            marketDailyRateAmountMinor: demo.marketDailyRateAmountMinor,
            currency: DEMO_CURRENCY,
            updatedAt: new Date(),
          },
        })
        .returning({ id: properties.id });

      // Images and amenity links are replaced wholesale: cheap at this size and
      // it keeps image order exactly as the catalogue declares it.
      await db.delete(propertyImages).where(eq(propertyImages.propertyId, row.id));
      await db.insert(propertyImages).values(
        demo.images.map((url, position) => ({
          propertyId: row.id,
          url,
          altText: `${demo.title} — ${demo.district}, ${demo.city}`,
          position,
        })),
      );

      await db
        .delete(propertyAmenities)
        .where(eq(propertyAmenities.propertyId, row.id));

      const links = demo.amenities
        .map((code) => amenityIdByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((amenityId) => ({ propertyId: row.id, amenityId }));

      if (links.length) await db.insert(propertyAmenities).values(links);
    }

    // Anything demo-shaped that is no longer in the catalogue should not linger.
    const slugs = DEMO_PROPERTIES.map((property) => property.slug);
    const stale = await db
      .select({ id: properties.id, slug: properties.slug })
      .from(properties)
      .where(eq(properties.hostId, DEMO_HOST_ID));
    const staleIds = stale
      .filter((property) => !slugs.includes(property.slug))
      .map((property) => property.id);
    if (staleIds.length) {
      await db.delete(properties).where(inArray(properties.id, staleIds));
    }

    console.log(
      `Seed zakończony: ${DEMO_PROPERTIES.length} Property, ${AMENITY_CODES.length} Amenity.`,
    );
    console.log(`Konto demo Host: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Seed nie powiódł się:", error);
  process.exit(1);
});
