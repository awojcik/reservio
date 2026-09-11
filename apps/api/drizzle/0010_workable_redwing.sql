CREATE TABLE "booking_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"sender_type" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_messages_sender_check" CHECK ("booking_messages"."sender_type" IN ('GUEST','HOST','SYSTEM')),
	CONSTRAINT "booking_messages_body_check" CHECK (length(btrim("booking_messages"."body")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "property_sensitive_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"access_instructions_encrypted" text,
	"access_code_encrypted" text,
	"keybox_location_encrypted" text,
	"reveal_offset_hours" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_sensitive_access_offset_check" CHECK ("property_sensitive_access"."reveal_offset_hours" BETWEEN 1 AND 336)
);
--> statement-breakpoint
CREATE TABLE "property_stay_information" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"check_in_time" text DEFAULT '15:00' NOT NULL,
	"check_out_time" text DEFAULT '11:00' NOT NULL,
	"arrival_instructions" text,
	"parking_instructions" text,
	"wifi_name" text,
	"wifi_password" text,
	"house_rules" text,
	"departure_instructions" text,
	"emergency_contact" text,
	"instructions_send_offset_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_stay_information_check_in_time_check" CHECK ("property_stay_information"."check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "property_stay_information_check_out_time_check" CHECK ("property_stay_information"."check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "property_stay_information_offset_check" CHECK ("property_stay_information"."instructions_send_offset_hours" BETWEEN 1 AND 336)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "sensitive_access_revealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_conversations" ADD CONSTRAINT "booking_conversations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_conversation_id_booking_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."booking_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_sensitive_access" ADD CONSTRAINT "property_sensitive_access_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_stay_information" ADD CONSTRAINT "property_stay_information_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_conversations_booking_key" ON "booking_conversations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_messages_conversation_idx" ON "booking_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "booking_messages_created_at_idx" ON "booking_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "booking_messages_conversation_created_idx" ON "booking_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "property_sensitive_access_property_key" ON "property_sensitive_access" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_stay_information_property_key" ON "property_stay_information" USING btree ("property_id");