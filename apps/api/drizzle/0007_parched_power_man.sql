ALTER TABLE "bookings" ADD COLUMN "guest_user_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "property_city_snapshot" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cover_image_url_snapshot" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_locale" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_user_id_users_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_guest_user_idx" ON "bookings" USING btree ("guest_user_id");