/**
 * Database schema — see docs/DATABASE.md for the full design and the reasons behind it.
 * Day 2 tables: merchants, merchant_users, policies, products, buyers, orders, order_items, shipments.
 *
 * Rules from the design: every row belongs to one merchant; money is integer cents;
 * ids are UUIDs; times are timestamptz (UTC); raw PayPal payloads are kept as jsonb.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ── Custom column types ───────────────────────────────────────────────────────

/** Case-insensitive text (Postgres `citext` extension) — for emails. */
const citext = customType<{ data: string }>({ dataType: () => "citext" });

/** Raw bytes — for encrypted secrets. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const cents = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── Enums ─────────────────────────────────────────────────────────────────────

export const paypalEnv = pgEnum("paypal_env", ["sandbox", "live"]);
export const merchantRole = pgEnum("merchant_role", ["owner", "staff"]);
export const trustTier = pgEnum("trust_tier", ["trusted", "normal", "watch", "high_risk"]);
export const orderSource = pgEnum("order_source", ["demo_store", "paypal_sync"]);
export const orderStatus = pgEnum("order_status", ["created", "captured", "partially_refunded", "refunded", "cancelled"]);
export const shipmentStatus = pgEnum("shipment_status", ["shipped", "on_hold", "delivered", "cancelled", "lost"]);

// ── 3.1 Merchants and settings ────────────────────────────────────────────────

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  paypalEnv: paypalEnv("paypal_env").notNull().default("sandbox"),
  paypalClientId: text("paypal_client_id"),
  paypalClientSecretEnc: bytea("paypal_client_secret_enc"),
  paypalMerchantId: text("paypal_merchant_id"),
  softDescriptor: varchar("soft_descriptor", { length: 22 }),
  storeNotes: text("store_notes"),
  createdAt: createdAt(),
});

export const merchantUsers = pgTable("merchant_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: merchantRole("role").notNull().default("owner"),
  createdAt: createdAt(),
});

export const policies = pgTable("policies", {
  merchantId: uuid("merchant_id")
    .primaryKey()
    .references(() => merchants.id, { onDelete: "cascade" }),
  autoRefundLimitCents: cents("auto_refund_limit_cents").notNull().default(5000),
  trustedAutoRefundLimitCents: cents("trusted_auto_refund_limit_cents").notNull().default(10000),
  reshipAllowed: boolean("reship_allowed").notNull().default(true),
  maxReshipsPerOrder: integer("max_reships_per_order").notNull().default(1),
  notReceivedWaitDays: integer("not_received_wait_days").notNull().default(7),
  watchClaims90d: integer("watch_claims_90d").notNull().default(2),
  watchClaimRatePct: integer("watch_claim_rate_pct").notNull().default(20),
  highRiskDeliveredClaims: integer("high_risk_delivered_claims").notNull().default(2),
  approvalSlaHours: integer("approval_sla_hours").notNull().default(24),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ── 3.2 Buyers ────────────────────────────────────────────────────────────────

export const buyers = pgTable(
  "buyers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    paypalPayerId: text("paypal_payer_id"),
    name: text("name"),
    /** SHA-256 of the normalized shipping address — links accounts at the same address. */
    addressHash: text("address_hash"),
    trustTier: trustTier("trust_tier").notNull().default("normal"),
    tierReasons: jsonb("tier_reasons").$type<string[]>().notNull().default([]),
    tierComputedAt: ts("tier_computed_at"),
    /** Merchant override; wins over trust_tier. */
    manualTier: trustTier("manual_tier"),
    flagged: boolean("flagged").notNull().default(false),
    flaggedReason: text("flagged_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("buyers_merchant_email_uq").on(t.merchantId, t.email),
    index("buyers_merchant_payer_idx").on(t.merchantId, t.paypalPayerId),
    index("buyers_merchant_address_idx").on(t.merchantId, t.addressHash),
  ],
);

// ── 3.3 Store, orders, shipping ───────────────────────────────────────────────

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: cents("price_cents").notNull(),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  imageUrl: text("image_url"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export type ShippingAddress = {
  name?: string;
  address_line_1?: string;
  address_line_2?: string;
  admin_area_2?: string; // city
  admin_area_1?: string; // state
  postal_code?: string;
  country_code?: string;
};

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    buyerId: uuid("buyer_id").references(() => buyers.id),
    orderNumber: text("order_number").notNull(),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    source: orderSource("source").notNull().default("demo_store"),
    status: orderStatus("status").notNull().default("created"),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    amountCents: cents("amount_cents").notNull(),
    refundedCents: cents("refunded_cents").notNull().default(0),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>(),
    softDescriptor: varchar("soft_descriptor", { length: 22 }),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    capturedAt: ts("captured_at"),
  },
  (t) => [
    uniqueIndex("orders_merchant_number_uq").on(t.merchantId, t.orderNumber),
    index("orders_merchant_created_idx").on(t.merchantId, t.createdAt.desc()),
    index("orders_buyer_idx").on(t.buyerId),
    check("orders_refund_within_amount", sql`${t.refundedCents} >= 0 AND ${t.refundedCents} <= ${t.amountCents}`),
    check("orders_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  sku: text("sku"),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: cents("unit_price_cents").notNull(),
  imageUrl: text("image_url"),
});

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    carrier: text("carrier").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    paypalTrackerId: text("paypal_tracker_id"),
    status: shipmentStatus("status").notNull().default("shipped"),
    isReship: boolean("is_reship").notNull().default(false),
    replacesShipmentId: uuid("replaces_shipment_id").references((): AnyPgColumn => shipments.id),
    shippedAt: ts("shipped_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    lastStatusAt: ts("last_status_at").notNull().defaultNow(),
  },
  (t) => [index("shipments_order_idx").on(t.orderId)],
);
