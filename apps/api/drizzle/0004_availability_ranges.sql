-- What Drizzle cannot model for availability: the GiST index that makes range
-- overlap a real index lookup, and the identity constraint that lets iCal
-- reconciliation upsert instead of duplicating.

-- Every availability question is "does this range overlap any block?", so the
-- overlap operator (&&) must be indexable. A B-tree cannot answer that.
CREATE INDEX "availability_blocks_range_gist_idx"
  ON "availability_blocks" USING GIST ("date_range");
--> statement-breakpoint

-- Overlap is always evaluated per Property, so the composite index lets one
-- scan do both. `gist_uuid_ops` comes from btree_gist.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

CREATE INDEX "availability_blocks_property_range_gist_idx"
  ON "availability_blocks" USING GIST ("property_id", "date_range");
--> statement-breakpoint

-- One row per imported event, so a re-sync of an unchanged feed is a no-op
-- rather than a pile of duplicates. Partial, because HOST_BLOCK rows carry
-- neither a calendar nor a UID.
CREATE UNIQUE INDEX "availability_blocks_external_identity_key"
  ON "availability_blocks" ("external_calendar_id", "external_event_uid")
  WHERE "external_calendar_id" IS NOT NULL AND "external_event_uid" IS NOT NULL;
