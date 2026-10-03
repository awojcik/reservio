CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_actor_check" CHECK ("booking_events"."actor_type" IN ('GUEST','HOST','SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "booking_guest_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_address" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"dedup_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" IN ('PENDING','SENT','FAILED')),
	CONSTRAINT "notification_deliveries_recipient_check" CHECK ("notification_deliveries"."recipient_type" IN ('GUEST','HOST')),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload_json" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('PENDING','PROCESSING','PROCESSED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "host_response_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_guest_access_tokens" ADD CONSTRAINT "booking_guest_access_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_events_created_at_idx" ON "booking_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_guest_access_tokens_token_hash_key" ON "booking_guest_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "booking_guest_access_tokens_booking_idx" ON "booking_guest_access_tokens" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedup_key" ON "notification_deliveries" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_booking_idx" ON "notification_deliveries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbox_events_status_created_idx" ON "outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "bookings_host_response_deadline_idx" ON "bookings" USING btree ("host_response_deadline_at");