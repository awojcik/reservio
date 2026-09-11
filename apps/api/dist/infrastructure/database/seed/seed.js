"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const argon2_1 = __importDefault(require("argon2"));
const drizzle_orm_1 = require("drizzle-orm");
const load_env_1 = require("../../config/load-env");
const connection_1 = require("../connection");
const schema_1 = require("../schema");
const demo_properties_1 = require("./demo-properties");
(0, load_env_1.loadEnv)();
const DEMO_HOST_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000002";
const DEMO_EMAIL = "host@rezervio.local";
const DEMO_PASSWORD = "rezervio-demo-2026";
async function main() {
    const { db, client } = (0, connection_1.createDatabase)();
    try {
        const passwordHash = await argon2_1.default.hash(DEMO_PASSWORD, { type: argon2_1.default.argon2id });
        await db
            .insert(schema_1.users)
            .values({ id: DEMO_USER_ID, email: DEMO_EMAIL, passwordHash })
            .onConflictDoUpdate({
            target: schema_1.users.id,
            set: { email: DEMO_EMAIL, passwordHash, updatedAt: new Date() },
        });
        await db
            .insert(schema_1.hosts)
            .values({ id: DEMO_HOST_ID, userId: DEMO_USER_ID, displayName: demo_properties_1.DEMO_HOST_NAME })
            .onConflictDoUpdate({
            target: schema_1.hosts.id,
            set: { userId: DEMO_USER_ID, displayName: demo_properties_1.DEMO_HOST_NAME, updatedAt: new Date() },
        });
        await db
            .insert(schema_1.amenities)
            .values(demo_properties_1.AMENITY_CODES.map((code) => ({ code })))
            .onConflictDoNothing({ target: schema_1.amenities.code });
        const amenityRows = await db
            .select({ id: schema_1.amenities.id, code: schema_1.amenities.code })
            .from(schema_1.amenities);
        const amenityIdByCode = new Map(amenityRows.map((row) => [row.code, row.id]));
        for (const demo of demo_properties_1.DEMO_PROPERTIES) {
            const [row] = await db
                .insert(schema_1.properties)
                .values({
                hostId: DEMO_HOST_ID,
                slug: demo.slug,
                title: demo.title,
                description: demo.description,
                propertyType: demo.propertyType,
                status: "PUBLISHED",
                city: demo.city,
                district: demo.district,
                addressLine1: demo.addressLine1,
                postalCode: demo.postalCode,
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
                currency: demo_properties_1.DEMO_CURRENCY,
            })
                .onConflictDoUpdate({
                target: schema_1.properties.slug,
                set: {
                    title: demo.title,
                    description: demo.description,
                    propertyType: demo.propertyType,
                    status: "PUBLISHED",
                    city: demo.city,
                    district: demo.district,
                    addressLine1: demo.addressLine1,
                    postalCode: demo.postalCode,
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
                    currency: demo_properties_1.DEMO_CURRENCY,
                    updatedAt: new Date(),
                },
            })
                .returning({ id: schema_1.properties.id });
            await db.delete(schema_1.propertyImages).where((0, drizzle_orm_1.eq)(schema_1.propertyImages.propertyId, row.id));
            await db.insert(schema_1.propertyImages).values(demo.images.map((url, position) => ({
                propertyId: row.id,
                url,
                altText: `${demo.title} — ${demo.district}, ${demo.city}`,
                position,
            })));
            await db
                .delete(schema_1.propertyAmenities)
                .where((0, drizzle_orm_1.eq)(schema_1.propertyAmenities.propertyId, row.id));
            const links = demo.amenities
                .map((code) => amenityIdByCode.get(code))
                .filter((id) => Boolean(id))
                .map((amenityId) => ({ propertyId: row.id, amenityId }));
            if (links.length)
                await db.insert(schema_1.propertyAmenities).values(links);
        }
        const slugs = demo_properties_1.DEMO_PROPERTIES.map((property) => property.slug);
        const stale = await db
            .select({ id: schema_1.properties.id, slug: schema_1.properties.slug })
            .from(schema_1.properties)
            .where((0, drizzle_orm_1.eq)(schema_1.properties.hostId, DEMO_HOST_ID));
        const staleIds = stale
            .filter((property) => !slugs.includes(property.slug))
            .map((property) => property.id);
        if (staleIds.length) {
            await db.delete(schema_1.properties).where((0, drizzle_orm_1.inArray)(schema_1.properties.id, staleIds));
        }
        console.log(`Seed zakończony: ${demo_properties_1.DEMO_PROPERTIES.length} Property, ${demo_properties_1.AMENITY_CODES.length} Amenity.`);
        console.log(`Konto demo Host: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    }
    finally {
        await client.end();
    }
}
main().catch((error) => {
    console.error("Seed nie powiódł się:", error);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map