CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase_check" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "city" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "district" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "max_guests" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "bedrooms" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "beds" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "bathrooms" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "rating" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "review_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "base_daily_rate_amount_minor" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "cleaning_fee_amount_minor" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "property_images" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "property_images" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hosts_user_id_key" ON "hosts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "properties_host_id_idx" ON "properties" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_images_object_key_key" ON "property_images" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_currency_check" CHECK ("properties"."currency" IN ('PLN','EUR','USD','GBP'));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_latitude_check" CHECK ("properties"."latitude" IS NULL OR ("properties"."latitude" >= -90 AND "properties"."latitude" <= 90));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_longitude_check" CHECK ("properties"."longitude" IS NULL OR ("properties"."longitude" >= -180 AND "properties"."longitude" <= 180));--> statement-breakpoint
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_source_check" CHECK ("property_images"."object_key" IS NOT NULL OR "property_images"."url" IS NOT NULL);