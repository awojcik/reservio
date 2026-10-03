CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"date_range" daterange NOT NULL,
	"external_calendar_id" uuid,
	"external_event_uid" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_blocks_source_check" CHECK ("availability_blocks"."source_type" IN ('HOST_BLOCK','EXTERNAL_CALENDAR','BOOKING','BOOKING_HOLD','MAINTENANCE')),
	CONSTRAINT "availability_blocks_range_check" CHECK (lower("availability_blocks"."date_range") < upper("availability_blocks"."date_range")),
	CONSTRAINT "availability_blocks_external_link_check" CHECK (("availability_blocks"."source_type" = 'EXTERNAL_CALENDAR') = ("availability_blocks"."external_calendar_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "calendar_export_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"import_url_encrypted" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_succeeded_at" timestamp with time zone,
	"last_sync_failed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_calendars_provider_check" CHECK ("external_calendars"."provider" IN ('BOOKING','AIRBNB','VRBO','PMS','OTHER')),
	CONSTRAINT "external_calendars_status_check" CHECK ("external_calendars"."status" IN ('ACTIVE','DISABLED')),
	CONSTRAINT "external_calendars_failures_check" CHECK ("external_calendars"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_external_calendar_id_external_calendars_id_fk" FOREIGN KEY ("external_calendar_id") REFERENCES "public"."external_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_export_tokens" ADD CONSTRAINT "calendar_export_tokens_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_calendars" ADD CONSTRAINT "external_calendars_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_property_idx" ON "availability_blocks" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "availability_blocks_external_calendar_idx" ON "availability_blocks" USING btree ("external_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_export_tokens_token_hash_key" ON "calendar_export_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "calendar_export_tokens_property_idx" ON "calendar_export_tokens" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "external_calendars_property_idx" ON "external_calendars" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "external_calendars_status_idx" ON "external_calendars" USING btree ("status","last_sync_succeeded_at");