CREATE TYPE "public"."sync_kind" AS ENUM('disputes', 'transactions');--> statement-breakpoint
CREATE TABLE "sync_state" (
	"merchant_id" uuid NOT NULL,
	"kind" "sync_kind" NOT NULL,
	"last_polled_at" timestamp with time zone,
	"cursor" text,
	"last_error" text,
	CONSTRAINT "sync_state_merchant_id_kind_pk" PRIMARY KEY("merchant_id","kind")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "allowed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "updated_at_paypal" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;