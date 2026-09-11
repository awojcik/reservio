CREATE TABLE "host_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL,
	"provider_account_id" text NOT NULL,
	"onboarding_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_payment_accounts_provider_check" CHECK ("host_payment_accounts"."provider" IN ('STRIPE')),
	CONSTRAINT "host_payment_accounts_status_check" CHECK ("host_payment_accounts"."onboarding_status" IN ('NOT_STARTED','IN_PROGRESS','READY','RESTRICTED'))
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_events_provider_check" CHECK ("payment_provider_events"."provider" IN ('STRIPE'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL,
	"provider_payment_id" text,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"platform_fee_amount_minor" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" IN ('STRIPE')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('CREATED','PROCESSING','REQUIRES_ACTION','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_fee_check" CHECK ("payments"."platform_fee_amount_minor" >= 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" IN ('PLN','EUR','USD','GBP'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider_refund_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "refunds_type_check" CHECK ("refunds"."type" IN ('FULL','PARTIAL')),
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
	CONSTRAINT "refunds_reason_check" CHECK ("refunds"."reason" IN ('PAYMENT_AFTER_HOLD_EXPIRY','AMOUNT_MISMATCH','HOST_CANCELLED','GUEST_CANCELLED')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "host_payment_accounts" ADD CONSTRAINT "host_payment_accounts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_payment_accounts_host_provider_key" ON "host_payment_accounts" USING btree ("host_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "host_payment_accounts_provider_account_key" ON "host_payment_accounts" USING btree ("provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_event_key" ON "payment_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_processed_idx" ON "payment_provider_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_booking_open_key" ON "payments" USING btree ("booking_id") WHERE "payments"."status" IN ('CREATED','PROCESSING','REQUIRES_ACTION');--> statement-breakpoint
CREATE INDEX "refunds_booking_idx" ON "refunds" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds" USING btree ("provider_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_payment_reason_key" ON "refunds" USING btree ("payment_id","reason");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_booking_idx" ON "availability_blocks" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_booking_link_check" CHECK (("availability_blocks"."source_type" = 'BOOKING') = ("availability_blocks"."booking_id" IS NOT NULL));