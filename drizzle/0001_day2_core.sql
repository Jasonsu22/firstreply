CREATE TYPE "public"."merchant_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('demo_store', 'paypal_sync');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'captured', 'partially_refunded', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."paypal_env" AS ENUM('sandbox', 'live');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('shipped', 'on_hold', 'delivered', 'cancelled', 'lost');--> statement-breakpoint
CREATE TYPE "public"."trust_tier" AS ENUM('trusted', 'normal', 'watch', 'high_risk');--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"paypal_payer_id" text,
	"name" text,
	"address_hash" text,
	"trust_tier" "trust_tier" DEFAULT 'normal' NOT NULL,
	"tier_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier_computed_at" timestamp with time zone,
	"manual_tier" "trust_tier",
	"flagged" boolean DEFAULT false NOT NULL,
	"flagged_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"role" "merchant_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"paypal_env" "paypal_env" DEFAULT 'sandbox' NOT NULL,
	"paypal_client_id" text,
	"paypal_client_secret_enc" "bytea",
	"paypal_merchant_id" text,
	"soft_descriptor" varchar(22),
	"store_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"buyer_id" uuid,
	"order_number" text NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"source" "order_source" DEFAULT 'demo_store' NOT NULL,
	"status" "order_status" DEFAULT 'created' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"refunded_cents" bigint DEFAULT 0 NOT NULL,
	"shipping_address" jsonb,
	"soft_descriptor" varchar(22),
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone,
	CONSTRAINT "orders_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "orders_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "orders_refund_within_amount" CHECK ("orders"."refunded_cents" >= 0 AND "orders"."refunded_cents" <= "orders"."amount_cents"),
	CONSTRAINT "orders_amount_positive" CHECK ("orders"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"auto_refund_limit_cents" bigint DEFAULT 5000 NOT NULL,
	"trusted_auto_refund_limit_cents" bigint DEFAULT 10000 NOT NULL,
	"reship_allowed" boolean DEFAULT true NOT NULL,
	"max_reships_per_order" integer DEFAULT 1 NOT NULL,
	"not_received_wait_days" integer DEFAULT 7 NOT NULL,
	"watch_claims_90d" integer DEFAULT 2 NOT NULL,
	"watch_claim_rate_pct" integer DEFAULT 20 NOT NULL,
	"high_risk_delivered_claims" integer DEFAULT 2 NOT NULL,
	"approval_sla_hours" integer DEFAULT 24 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"image_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"tracking_number" text NOT NULL,
	"paypal_tracker_id" text,
	"status" "shipment_status" DEFAULT 'shipped' NOT NULL,
	"is_reship" boolean DEFAULT false NOT NULL,
	"replaces_shipment_id" uuid,
	"shipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_status_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_replaces_shipment_id_shipments_id_fk" FOREIGN KEY ("replaces_shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_merchant_email_uq" ON "buyers" USING btree ("merchant_id","email");--> statement-breakpoint
CREATE INDEX "buyers_merchant_payer_idx" ON "buyers" USING btree ("merchant_id","paypal_payer_id");--> statement-breakpoint
CREATE INDEX "buyers_merchant_address_idx" ON "buyers" USING btree ("merchant_id","address_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_merchant_number_uq" ON "orders" USING btree ("merchant_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_merchant_created_idx" ON "orders" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");