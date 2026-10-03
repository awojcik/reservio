CREATE TABLE "booking_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"date_range" daterange NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "booking_holds_status_check" CHECK ("booking_holds"."status" IN ('ACTIVE','RELEASED','EXPIRED','CONVERTED')),
	CONSTRAINT "booking_holds_range_check" CHECK (lower("booking_holds"."date_range") < upper("booking_holds"."date_range"))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_reference" text NOT NULL,
	"property_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"booking_mode" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"adults" integer NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"guest_phone" text,
	"property_title_snapshot" text NOT NULL,
	"accommodation_amount_minor" integer NOT NULL,
	"cleaning_fee_amount_minor" integer NOT NULL,
	"service_fee_amount_minor" integer DEFAULT 0 NOT NULL,
	"tax_amount_minor" integer DEFAULT 0 NOT NULL,
	"discount_amount_minor" integer DEFAULT 0 NOT NULL,
	"total_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"host_responded_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED','CANCELLED','EXPIRED','COMPLETED')),
	CONSTRAINT "bookings_mode_check" CHECK ("bookings"."booking_mode" IN ('REQUEST_TO_BOOK','INSTANT_BOOK')),
	CONSTRAINT "bookings_stay_check" CHECK ("bookings"."check_out" > "bookings"."check_in"),
	CONSTRAINT "bookings_adults_check" CHECK ("bookings"."adults" >= 1),
	CONSTRAINT "bookings_children_check" CHECK ("bookings"."children" >= 0),
	CONSTRAINT "bookings_accommodation_check" CHECK ("bookings"."accommodation_amount_minor" >= 0),
	CONSTRAINT "bookings_cleaning_check" CHECK ("bookings"."cleaning_fee_amount_minor" >= 0),
	CONSTRAINT "bookings_service_fee_check" CHECK ("bookings"."service_fee_amount_minor" >= 0),
	CONSTRAINT "bookings_tax_check" CHECK ("bookings"."tax_amount_minor" >= 0),
	CONSTRAINT "bookings_discount_check" CHECK ("bookings"."discount_amount_minor" >= 0),
	CONSTRAINT "bookings_total_check" CHECK ("bookings"."total_amount_minor" >= 0),
	CONSTRAINT "bookings_currency_check" CHECK ("bookings"."currency" IN ('PLN','EUR','USD','GBP'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD COLUMN "booking_hold_id" uuid;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "booking_mode" text DEFAULT 'REQUEST_TO_BOOK' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_holds_booking_id_key" ON "booking_holds" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_holds_property_idx" ON "booking_holds" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "booking_holds_status_idx" ON "booking_holds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "booking_holds_expires_at_idx" ON "booking_holds" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_public_reference_key" ON "bookings" USING btree ("public_reference");--> statement-breakpoint
CREATE INDEX "bookings_property_idx" ON "bookings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "bookings_host_idx" ON "bookings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_created_at_idx" ON "bookings" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key" ON "idempotency_keys" USING btree ("scope","key_hash");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_booking_hold_id_booking_holds_id_fk" FOREIGN KEY ("booking_hold_id") REFERENCES "public"."booking_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_booking_hold_idx" ON "availability_blocks" USING btree ("booking_hold_id");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_hold_link_check" CHECK (("availability_blocks"."source_type" = 'BOOKING_HOLD') = ("availability_blocks"."booking_hold_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_booking_mode_check" CHECK ("properties"."booking_mode" IN ('REQUEST_TO_BOOK','INSTANT_BOOK'));