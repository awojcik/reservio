CREATE TABLE "booking_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"gross_amount_minor" integer NOT NULL,
	"platform_fee_minor" integer NOT NULL,
	"host_amount_minor" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL,
	"provider_transfer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone,
	"transferred_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	CONSTRAINT "booking_settlements_status_check" CHECK ("booking_settlements"."status" IN ('PENDING','AVAILABLE','TRANSFER_PENDING','TRANSFERRED','CANCELLED','FAILED','REVERSAL_PENDING','REVERSED')),
	CONSTRAINT "booking_settlements_gross_check" CHECK ("booking_settlements"."gross_amount_minor" >= 0),
	CONSTRAINT "booking_settlements_fee_check" CHECK ("booking_settlements"."platform_fee_minor" >= 0),
	CONSTRAINT "booking_settlements_host_amount_check" CHECK ("booking_settlements"."host_amount_minor" >= 0),
	CONSTRAINT "booking_settlements_split_check" CHECK ("booking_settlements"."host_amount_minor" + "booking_settlements"."platform_fee_minor" = "booking_settlements"."gross_amount_minor"),
	CONSTRAINT "booking_settlements_currency_check" CHECK ("booking_settlements"."currency" IN ('PLN','EUR','USD','GBP'))
);
--> statement-breakpoint
CREATE TABLE "host_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL,
	"provider_payout_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"arrival_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	CONSTRAINT "host_payouts_status_check" CHECK ("host_payouts"."status" IN ('PENDING','IN_TRANSIT','PAID','FAILED','CANCELLED')),
	CONSTRAINT "host_payouts_amount_check" CHECK ("host_payouts"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "host_transfer_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"provider_reversal_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	CONSTRAINT "host_transfer_reversals_status_check" CHECK ("host_transfer_reversals"."status" IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
	CONSTRAINT "host_transfer_reversals_reason_check" CHECK ("host_transfer_reversals"."reason" IN ('REFUNDED_AFTER_TRANSFER')),
	CONSTRAINT "host_transfer_reversals_amount_check" CHECK ("host_transfer_reversals"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "host_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL,
	"provider_transfer_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	CONSTRAINT "host_transfers_status_check" CHECK ("host_transfers"."status" IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','REVERSAL_PENDING','REVERSED')),
	CONSTRAINT "host_transfers_amount_check" CHECK ("host_transfers"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_payouts" ADD CONSTRAINT "host_payouts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_transfer_reversals" ADD CONSTRAINT "host_transfer_reversals_transfer_id_host_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."host_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_transfer_reversals" ADD CONSTRAINT "host_transfer_reversals_settlement_id_booking_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."booking_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_transfers" ADD CONSTRAINT "host_transfers_settlement_id_booking_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."booking_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_transfers" ADD CONSTRAINT "host_transfers_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_settlements_booking_key" ON "booking_settlements" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_settlements_host_idx" ON "booking_settlements" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "booking_settlements_status_idx" ON "booking_settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "booking_settlements_status_release_idx" ON "booking_settlements" USING btree ("status","release_at");--> statement-breakpoint
CREATE INDEX "host_payouts_host_idx" ON "host_payouts" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_payouts_provider_payout_key" ON "host_payouts" USING btree ("provider_payout_id");--> statement-breakpoint
CREATE INDEX "host_payouts_status_idx" ON "host_payouts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "host_transfer_reversals_transfer_reason_key" ON "host_transfer_reversals" USING btree ("transfer_id","reason");--> statement-breakpoint
CREATE INDEX "host_transfer_reversals_settlement_idx" ON "host_transfer_reversals" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_transfer_reversals_provider_key" ON "host_transfer_reversals" USING btree ("provider_reversal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_transfers_settlement_live_key" ON "host_transfers" USING btree ("settlement_id") WHERE "host_transfers"."status" <> 'FAILED';--> statement-breakpoint
CREATE INDEX "host_transfers_settlement_idx" ON "host_transfers" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "host_transfers_host_idx" ON "host_transfers" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "host_transfers_status_idx" ON "host_transfers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "host_transfers_provider_transfer_key" ON "host_transfers" USING btree ("provider_transfer_id");