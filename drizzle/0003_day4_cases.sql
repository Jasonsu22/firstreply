CREATE TYPE "public"."action_actor" AS ENUM('agent', 'merchant', 'system', 'worker');--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('ok', 'error', 'blocked_by_policy');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."case_issue_type" AS ENUM('not_received', 'not_as_described', 'damaged', 'unrecognized_charge', 'cancel', 'other');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('open', 'awaiting_buyer', 'awaiting_merchant', 'resolved', 'escalated', 'disputed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispute_outcome" AS ENUM('won_by_seller', 'won_by_buyer', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dispute_reason" AS ENUM('merchandise_or_service_not_received', 'merchandise_or_service_not_as_described', 'unauthorised', 'credit_not_processed', 'duplicate_transaction', 'incorrect_amount', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_stage" AS ENUM('inquiry', 'chargeback', 'pre_arbitration', 'arbitration');--> statement-breakpoint
CREATE TYPE "public"."fact_type" AS ENUM('tracking_status', 'delivery_confirmed', 'refund_issued', 'offer_made', 'offer_declined', 'inconsistency', 'order_details');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('proposed', 'pending_approval', 'offered', 'accepted', 'declined', 'expired', 'executed', 'rejected_by_merchant');--> statement-breakpoint
CREATE TYPE "public"."offer_type" AS ENUM('full_refund', 'partial_refund', 'reship', 'return_then_refund');--> statement-breakpoint
CREATE TYPE "public"."policy_decision" AS ENUM('allowed', 'needs_approval', 'denied');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."resolution_type" AS ENUM('full_refund', 'partial_refund', 'reship', 'explained', 'denied', 'none');--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"merchant_id" uuid NOT NULL,
	"actor" "action_actor" NOT NULL,
	"tool" text NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"status" "action_status" NOT NULL,
	"policy_decision" "policy_decision",
	"policy_reasons" jsonb,
	"agent_reason" text,
	"paypal_debug_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"requested_reason" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decision_note" text,
	"due_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "case_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"fact_type" "fact_type" NOT NULL,
	"value" jsonb NOT NULL,
	"source_action_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"issue_type" "case_issue_type" NOT NULL,
	"status" "case_status" DEFAULT 'open' NOT NULL,
	"resolution_type" "resolution_type",
	"resolution_amount_cents" bigint,
	"trust_tier_at_open" "trust_tier" NOT NULL,
	"summary" text,
	"last_seen_snapshot" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"disputed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"paypal_dispute_id" text NOT NULL,
	"order_id" uuid,
	"case_id" uuid,
	"buyer_id" uuid,
	"reason" "dispute_reason" NOT NULL,
	"stage" "dispute_stage" NOT NULL,
	"status" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"seller_response_due_at" timestamp with time zone,
	"outcome" "dispute_outcome",
	"raw" jsonb,
	"created_at_paypal" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_paypal_dispute_id_unique" UNIQUE("paypal_dispute_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" "offer_type" NOT NULL,
	"amount_cents" bigint,
	"policy_decision" "policy_decision" NOT NULL,
	"status" "offer_status" DEFAULT 'proposed' NOT NULL,
	"offered_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"executed_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"offer_id" uuid,
	"idempotency_key" text NOT NULL,
	"paypal_refund_id" text,
	"amount_cents" bigint NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "refunds_paypal_refund_id_unique" UNIQUE("paypal_refund_id")
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_merchant_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."merchant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_source_action_id_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_executed_action_id_actions_id_fk" FOREIGN KEY ("executed_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_case_idx" ON "actions" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_status_due_idx" ON "approvals" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "case_facts_case_idx" ON "case_facts" USING btree ("case_id","fact_type","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "cases_one_active_per_order_uq" ON "cases" USING btree ("order_id") WHERE "cases"."status" NOT IN ('resolved', 'closed');--> statement-breakpoint
CREATE INDEX "cases_merchant_status_idx" ON "cases" USING btree ("merchant_id","status","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cases_buyer_idx" ON "cases" USING btree ("buyer_id","opened_at");--> statement-breakpoint
CREATE INDEX "disputes_merchant_status_idx" ON "disputes" USING btree ("merchant_id","status","seller_response_due_at");