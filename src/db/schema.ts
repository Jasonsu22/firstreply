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
  pgSequence,
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

/** Human-friendly order numbers (FR-20001, FR-20002, …), shared by all stores. Seeded history uses FR-1xxxx. */
export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 20001 });

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

// ── 3.4–3.6 Cases, audit log, facts, offers, money, disputes (day 4) ──────────

export const caseIssueType = pgEnum("case_issue_type", [
  "not_received",
  "not_as_described",
  "damaged",
  "unrecognized_charge",
  "cancel",
  "other",
]);
export const caseStatus = pgEnum("case_status", [
  "open",
  "awaiting_buyer",
  "awaiting_merchant",
  "resolved",
  "escalated",
  "disputed",
  "closed",
]);
export const resolutionType = pgEnum("resolution_type", ["full_refund", "partial_refund", "reship", "explained", "denied", "none"]);
export const actionActor = pgEnum("action_actor", ["agent", "merchant", "system", "worker"]);
export const actionStatus = pgEnum("action_status", ["ok", "error", "blocked_by_policy"]);
export const policyDecision = pgEnum("policy_decision", ["allowed", "needs_approval", "denied"]);
export const factType = pgEnum("fact_type", [
  "tracking_status",
  "delivery_confirmed",
  "refund_issued",
  "offer_made",
  "offer_declined",
  "inconsistency",
  "order_details",
]);
export const offerType = pgEnum("offer_type", ["full_refund", "partial_refund", "reship", "return_then_refund"]);
export const offerStatus = pgEnum("offer_status", [
  "proposed",
  "pending_approval",
  "offered",
  "accepted",
  "declined",
  "expired",
  "executed",
  "rejected_by_merchant",
]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "expired"]);
export const refundStatus = pgEnum("refund_status", ["pending", "completed", "failed"]);
export const disputeReason = pgEnum("dispute_reason", [
  "merchandise_or_service_not_received",
  "merchandise_or_service_not_as_described",
  "unauthorised",
  "credit_not_processed",
  "duplicate_transaction",
  "incorrect_amount",
  "other",
]);
export const disputeStage = pgEnum("dispute_stage", ["inquiry", "chargeback", "pre_arbitration", "arbitration"]);
export const disputeOutcome = pgEnum("dispute_outcome", ["won_by_seller", "won_by_buyer", "settled", "cancelled"]);

/** One buyer problem with one order. */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => buyers.id, { onDelete: "cascade" }),
    issueType: caseIssueType("issue_type").notNull(),
    status: caseStatus("status").notNull().default("open"),
    resolutionType: resolutionType("resolution_type"),
    resolutionAmountCents: cents("resolution_amount_cents"),
    /** Snapshot of the tier that applied when the case was decided. */
    trustTierAtOpen: trustTier("trust_tier_at_open").notNull(),
    /** Written by code from facts and offers — never by the LLM. */
    summary: text("summary"),
    /** Order + tracking state the buyer last saw, for "since last time". */
    lastSeenSnapshot: jsonb("last_seen_snapshot"),
    openedAt: ts("opened_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    disputedAt: ts("disputed_at"),
  },
  (t) => [
    // One active case per order.
    uniqueIndex("cases_one_active_per_order_uq")
      .on(t.orderId)
      .where(sql`${t.status} NOT IN ('resolved', 'closed')`),
    index("cases_merchant_status_idx").on(t.merchantId, t.status, t.openedAt.desc()),
    index("cases_buyer_idx").on(t.buyerId, t.openedAt),
  ],
);

/** Audit log of every tool call and decision. Append-only: a trigger rejects UPDATE and DELETE. */
export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    actor: actionActor("actor").notNull(),
    tool: text("tool").notNull(),
    arguments: jsonb("arguments").notNull().default({}),
    result: jsonb("result"),
    status: actionStatus("status").notNull(),
    policyDecision: policyDecision("policy_decision"),
    policyReasons: jsonb("policy_reasons").$type<string[]>(),
    agentReason: text("agent_reason"),
    paypalDebugId: text("paypal_debug_id"),
    createdAt: createdAt(),
  },
  (t) => [index("actions_case_idx").on(t.caseId, t.createdAt)],
);

/** Verified facts, each pointing at the logged action (real API result) that proves it. */
export const caseFacts = pgTable(
  "case_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    factType: factType("fact_type").notNull(),
    value: jsonb("value").notNull(),
    sourceActionId: uuid("source_action_id")
      .notNull()
      .references(() => actions.id),
    observedAt: ts("observed_at").notNull().defaultNow(),
  },
  (t) => [index("case_facts_case_idx").on(t.caseId, t.factType, t.observedAt.desc())],
);

export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id, { onDelete: "cascade" }),
  type: offerType("type").notNull(),
  amountCents: cents("amount_cents"),
  policyDecision: policyDecision("policy_decision").notNull(),
  status: offerStatus("status").notNull().default("proposed"),
  offeredAt: ts("offered_at"),
  answeredAt: ts("answered_at"),
  executedAt: ts("executed_at"),
  executedActionId: uuid("executed_action_id").references(() => actions.id),
  createdAt: createdAt(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .unique()
      .references(() => offers.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    requestedReason: text("requested_reason").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => merchantUsers.id),
    decisionNote: text("decision_note"),
    dueAt: ts("due_at").notNull(),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_status_due_idx").on(t.status, t.dueAt)],
);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  /** Null when refunded outside FirstReply (seen via sync) or seeded history. */
  offerId: uuid("offer_id").references(() => offers.id),
  /** Sent to PayPal as PayPal-Request-Id so a retry can never refund twice. */
  idempotencyKey: text("idempotency_key").notNull().unique(),
  paypalRefundId: text("paypal_refund_id").unique(),
  amountCents: cents("amount_cents").notNull(),
  status: refundStatus("status").notNull().default("pending"),
  createdAt: createdAt(),
});

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    paypalDisputeId: text("paypal_dispute_id").notNull().unique(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id),
    buyerId: uuid("buyer_id").references(() => buyers.id),
    reason: disputeReason("reason").notNull(),
    stage: disputeStage("stage").notNull(),
    status: text("status").notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    sellerResponseDueAt: ts("seller_response_due_at"),
    outcome: disputeOutcome("outcome"),
    raw: jsonb("raw"),
    createdAtPaypal: ts("created_at_paypal").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("disputes_merchant_status_idx").on(t.merchantId, t.status, t.sellerResponseDueAt)],
);
