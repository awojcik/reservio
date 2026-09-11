CREATE TABLE "external_inventory_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"status_reason" text,
	"external_account_id" text,
	"credentials_encrypted" text,
	"configuration_json" text,
	"last_successful_sync_at" timestamp with time zone,
	"last_failed_sync_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "external_inventory_connections_provider_check" CHECK ("external_inventory_connections"."provider" IN ('HOSTAWAY','CHANNEX')),
	CONSTRAINT "external_inventory_connections_status_check" CHECK ("external_inventory_connections"."status" IN ('PENDING','CONNECTED','DEGRADED','DISCONNECTED','ACTION_REQUIRED')),
	CONSTRAINT "external_inventory_connections_reason_check" CHECK ("external_inventory_connections"."status_reason" IS NULL OR "external_inventory_connections"."status_reason" IN ('PARTNER_ACCESS_REQUIRED','CREDENTIALS_MISSING','CREDENTIALS_REJECTED','PROVIDER_UNAVAILABLE','DISABLED_BY_HOST','DISABLED_BY_ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "external_property_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"external_property_id" text NOT NULL,
	"external_property_name" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_property_mappings_status_check" CHECK ("external_property_mappings"."status" IN ('ACTIVE','PAUSED'))
);
--> statement-breakpoint
CREATE TABLE "external_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_provider_events_provider_check" CHECK ("external_provider_events"."provider" IN ('HOSTAWAY','CHANNEX'))
);
--> statement-breakpoint
CREATE TABLE "external_reservation_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"booking_id" uuid,
	"property_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"check_in" date,
	"check_out" date,
	"last_error_code" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_reservation_mappings_provider_check" CHECK ("external_reservation_mappings"."provider" IN ('HOSTAWAY','CHANNEX')),
	CONSTRAINT "external_reservation_mappings_direction_check" CHECK ("external_reservation_mappings"."direction" IN ('INBOUND','OUTBOUND')),
	CONSTRAINT "external_reservation_mappings_status_check" CHECK ("external_reservation_mappings"."status" IN ('PENDING','ACTIVE','CANCELLED','FAILED')),
	CONSTRAINT "external_reservation_mappings_stay_check" CHECK ("external_reservation_mappings"."check_in" IS NULL OR "external_reservation_mappings"."check_out" IS NULL OR "external_reservation_mappings"."check_out" > "external_reservation_mappings"."check_in"),
	CONSTRAINT "external_reservation_mappings_attempts_check" CHECK ("external_reservation_mappings"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "external_sync_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"sync_type" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	CONSTRAINT "external_sync_attempts_type_check" CHECK ("external_sync_attempts"."sync_type" IN ('PROPERTY_DISCOVERY','INBOUND_RESERVATIONS','OUTBOUND_PUSH','OUTBOUND_CANCEL','RECONCILIATION','WEBHOOK','CONNECTION_CHECK')),
	CONSTRAINT "external_sync_attempts_status_check" CHECK ("external_sync_attempts"."status" IN ('RUNNING','SUCCEEDED','FAILED')),
	CONSTRAINT "external_sync_attempts_processed_check" CHECK ("external_sync_attempts"."items_processed" >= 0),
	CONSTRAINT "external_sync_attempts_failed_check" CHECK ("external_sync_attempts"."items_failed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" DROP CONSTRAINT "availability_blocks_source_check";--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD COLUMN "external_reservation_mapping_id" uuid;--> statement-breakpoint
ALTER TABLE "external_inventory_connections" ADD CONSTRAINT "external_inventory_connections_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_property_mappings" ADD CONSTRAINT "external_property_mappings_connection_id_external_inventory_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_inventory_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_property_mappings" ADD CONSTRAINT "external_property_mappings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_provider_events" ADD CONSTRAINT "external_provider_events_connection_id_external_inventory_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_inventory_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reservation_mappings" ADD CONSTRAINT "external_reservation_mappings_connection_id_external_inventory_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_inventory_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reservation_mappings" ADD CONSTRAINT "external_reservation_mappings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reservation_mappings" ADD CONSTRAINT "external_reservation_mappings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sync_attempts" ADD CONSTRAINT "external_sync_attempts_connection_id_external_inventory_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_inventory_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_inventory_connections_host_provider_key" ON "external_inventory_connections" USING btree ("host_id","provider");--> statement-breakpoint
CREATE INDEX "external_inventory_connections_status_idx" ON "external_inventory_connections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_property_mappings_connection_property_key" ON "external_property_mappings" USING btree ("connection_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_property_mappings_connection_external_key" ON "external_property_mappings" USING btree ("connection_id","external_property_id");--> statement-breakpoint
CREATE INDEX "external_property_mappings_property_idx" ON "external_property_mappings" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_provider_events_provider_event_key" ON "external_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "external_provider_events_processed_idx" ON "external_provider_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "external_provider_events_connection_idx" ON "external_provider_events" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_reservation_mappings_connection_external_key" ON "external_reservation_mappings" USING btree ("connection_id","external_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_reservation_mappings_outbound_booking_key" ON "external_reservation_mappings" USING btree ("connection_id","booking_id") WHERE "external_reservation_mappings"."direction" = 'OUTBOUND' AND "external_reservation_mappings"."status" <> 'FAILED';--> statement-breakpoint
CREATE INDEX "external_reservation_mappings_property_idx" ON "external_reservation_mappings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "external_reservation_mappings_status_idx" ON "external_reservation_mappings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "external_reservation_mappings_booking_idx" ON "external_reservation_mappings" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "external_sync_attempts_connection_started_idx" ON "external_sync_attempts" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE INDEX "external_sync_attempts_status_idx" ON "external_sync_attempts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_external_reservation_mapping_id_external_reservation_mappings_id_fk" FOREIGN KEY ("external_reservation_mapping_id") REFERENCES "public"."external_reservation_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_blocks_external_reservation_key" ON "availability_blocks" USING btree ("external_reservation_mapping_id");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_external_reservation_link_check" CHECK (("availability_blocks"."source_type" = 'EXTERNAL_PROVIDER') = ("availability_blocks"."external_reservation_mapping_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_source_check" CHECK ("availability_blocks"."source_type" IN ('HOST_BLOCK','EXTERNAL_CALENDAR','BOOKING','BOOKING_HOLD','MAINTENANCE','EXTERNAL_PROVIDER'));