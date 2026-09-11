CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text DEFAULT 'STARTED' NOT NULL,
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "admin_actions_type_check" CHECK ("admin_actions"."action_type" IN ('RETRY_NOTIFICATION','RETRY_REFUND','RETRY_TRANSFER','RETRY_JOB','ICAL_RESYNC','REFRESH_CONNECT_STATUS','RECONCILE')),
	CONSTRAINT "admin_actions_target_check" CHECK ("admin_actions"."target_type" IN ('BOOKING','NOTIFICATION','REFUND','SETTLEMENT','HOST','EXTERNAL_CALENDAR','JOB','PLATFORM')),
	CONSTRAINT "admin_actions_status_check" CHECK ("admin_actions"."status" IN ('STARTED','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_actions_admin_idx" ON "admin_actions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_actions_target_idx" ON "admin_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_roles_check" CHECK ("users"."roles" <@ ARRAY['SUPPORT','ADMIN']::text[]);