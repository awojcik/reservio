-- Everything Drizzle cannot model: extensions, the PostGIS point, the
-- full-text document, and the indexes that make search run in PostgreSQL
-- rather than in Node.

CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- Generated, so latitude/longitude stay the single source of truth and the
-- point can never drift out of sync with them.
ALTER TABLE "properties"
  ADD COLUMN "location" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
  ) STORED;
--> statement-breakpoint

-- 'simple' rather than a language dictionary: listings are multilingual and
-- MVP search should not stem Polish text with an English dictionary.
ALTER TABLE "properties"
  ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce("title", '') || ' ' ||
      coalesce("city", '') || ' ' ||
      coalesce("district", '') || ' ' ||
      coalesce("description", '')
    )
  ) STORED;
--> statement-breakpoint

CREATE INDEX "properties_location_gist_idx" ON "properties" USING GIST ("location");
--> statement-breakpoint
CREATE INDEX "properties_search_document_gin_idx" ON "properties" USING GIN ("search_document");
--> statement-breakpoint

-- Trigram indexes only where fuzzy matching actually runs: the destination
-- query is compared against these three columns and nothing else.
CREATE INDEX "properties_city_trgm_idx" ON "properties" USING GIN ("city" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "properties_district_trgm_idx" ON "properties" USING GIN ("district" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "properties_title_trgm_idx" ON "properties" USING GIN ("title" gin_trgm_ops);
