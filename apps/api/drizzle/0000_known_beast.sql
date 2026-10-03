CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"property_type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"country_code" text DEFAULT 'PL' NOT NULL,
	"time_zone" text DEFAULT 'Europe/Warsaw' NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"max_guests" integer NOT NULL,
	"bedrooms" integer NOT NULL,
	"beds" integer NOT NULL,
	"bathrooms" integer NOT NULL,
	"rating" real NOT NULL,
	"review_count" integer NOT NULL,
	"distance_to_beach_meters" integer,
	"base_daily_rate_amount_minor" integer NOT NULL,
	"cleaning_fee_amount_minor" integer NOT NULL,
	"market_daily_rate_amount_minor" integer,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_status_check" CHECK ("properties"."status" IN ('DRAFT','IN_REVIEW','PUBLISHED','SUSPENDED','ARCHIVED')),
	CONSTRAINT "properties_type_check" CHECK ("properties"."property_type" IN ('APARTMENT','HOUSE','VILLA','STUDIO')),
	CONSTRAINT "properties_max_guests_check" CHECK ("properties"."max_guests" > 0),
	CONSTRAINT "properties_bedrooms_check" CHECK ("properties"."bedrooms" >= 0),
	CONSTRAINT "properties_beds_check" CHECK ("properties"."beds" >= 0),
	CONSTRAINT "properties_bathrooms_check" CHECK ("properties"."bathrooms" >= 0),
	CONSTRAINT "properties_rating_check" CHECK ("properties"."rating" >= 0 AND "properties"."rating" <= 10),
	CONSTRAINT "properties_review_count_check" CHECK ("properties"."review_count" >= 0),
	CONSTRAINT "properties_base_rate_check" CHECK ("properties"."base_daily_rate_amount_minor" >= 0),
	CONSTRAINT "properties_cleaning_fee_check" CHECK ("properties"."cleaning_fee_amount_minor" >= 0),
	CONSTRAINT "properties_market_rate_check" CHECK ("properties"."market_daily_rate_amount_minor" IS NULL OR "properties"."market_daily_rate_amount_minor" >= 0),
	CONSTRAINT "properties_beach_distance_check" CHECK ("properties"."distance_to_beach_meters" IS NULL OR "properties"."distance_to_beach_meters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "property_amenities" (
	"property_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	CONSTRAINT "property_amenities_property_id_amenity_id_pk" PRIMARY KEY("property_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "property_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_images_position_check" CHECK ("property_images"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amenities_code_key" ON "amenities" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_slug_key" ON "properties" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "properties_status_idx" ON "properties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "properties_city_idx" ON "properties" USING btree ("city");--> statement-breakpoint
CREATE INDEX "properties_property_type_idx" ON "properties" USING btree ("property_type");--> statement-breakpoint
CREATE INDEX "property_amenities_amenity_idx" ON "property_amenities" USING btree ("amenity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_images_property_position_key" ON "property_images" USING btree ("property_id","position");