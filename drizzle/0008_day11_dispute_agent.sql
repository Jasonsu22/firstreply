CREATE TYPE "public"."draft_author" AS ENUM('agent', 'merchant');--> statement-breakpoint
CREATE TYPE "public"."draft_recommendation" AS ENUM('fight', 'offer', 'accept');--> statement-breakpoint
CREATE TYPE "public"."submission_action" AS ENUM('provide_evidence', 'provide_supporting_info', 'make_offer', 'accept_claim', 'send_message');--> statement-breakpoint
CREATE TABLE "dispute_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"recommendation" "draft_recommendation" NOT NULL,
	"action" "submission_action" NOT NULL,
	"reasoning" text NOT NULL,
	"response_text" text NOT NULL,
	"evidence_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offer_amount_cents" bigint,
	"created_by" "draft_author" NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"draft_id" uuid,
	"action" "submission_action" NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"ok" boolean NOT NULL,
	"paypal_debug_id" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispute_drafts" ADD CONSTRAINT "dispute_drafts_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_submissions" ADD CONSTRAINT "dispute_submissions_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_submissions" ADD CONSTRAINT "dispute_submissions_draft_id_dispute_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."dispute_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_submissions" ADD CONSTRAINT "dispute_submissions_submitted_by_merchant_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."merchant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_drafts_version_uq" ON "dispute_drafts" USING btree ("dispute_id","version");