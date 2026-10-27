import { describe, expect, it } from "vitest";
import { describeAction, type ActionRow } from "./timeline";

const row = (patch: Partial<ActionRow>): ActionRow => ({
  tool: "get_order",
  actor: "agent",
  status: "ok",
  arguments: {},
  result: {},
  policyDecision: null,
  policyReasons: null,
  agentReason: null,
  paypalDebugId: null,
  ...patch,
});

describe("describeAction", () => {
  it("describes a tracking check with carrier and number", () => {
    const e = describeAction(row({ tool: "get_shipment_status", result: { shipped: true, status: "on_hold", carrier: "UPS", tracking_number: "1Z9" } }));
    expect(e).toMatchObject({ title: "Checked tracking: on hold", detail: "UPS 1Z9", tone: "check" });
  });

  it("says when an order hasn't shipped", () => {
    expect(describeAction(row({ tool: "get_shipment_status", result: { shipped: false } })).detail).toBe("Not shipped yet");
  });

  it("shows each policy decision with its amount and reasons", () => {
    const base = { tool: "propose_resolution", arguments: { type: "full_refund" }, result: { amountCents: 4500 } };
    expect(describeAction(row({ ...base, policyDecision: "allowed", policyReasons: ["Within limits"] }))).toMatchObject({
      title: "Policy allowed a full refund of $45.00",
      tone: "allowed",
      reasons: ["Within limits"],
    });
    expect(describeAction(row({ ...base, policyDecision: "needs_approval" })).tone).toBe("approval");
    expect(describeAction(row({ ...base, status: "blocked_by_policy", policyDecision: "denied", result: { amountCents: 0 } })).title).toBe("Policy refused a full refund");
  });

  it("links a refund to its PayPal id", () => {
    const e = describeAction(row({ tool: "issue_refund", arguments: { amount_cents: 4500 }, result: { paypal: { id: "1Y68", status: "COMPLETED" } } }));
    expect(e).toMatchObject({ title: "Refunded $45.00 through PayPal", tone: "money", paypalRef: "refund 1Y68" });
  });

  it("marks failures and keeps the PayPal debug id", () => {
    const e = describeAction(row({ tool: "issue_refund", status: "error", result: { error: "INSUFFICIENT_FUNDS" }, paypalDebugId: "abc123" }));
    expect(e).toMatchObject({ title: "issue refund failed", detail: "INSUFFICIENT_FUNDS", tone: "error", paypalRef: "debug id abc123" });
  });

  it("names who approved or rejected", () => {
    expect(describeAction(row({ tool: "approve_offer", actor: "merchant", arguments: { by: "owner@trailhead.test" } }))).toMatchObject({ title: "Approved by owner@trailhead.test", tone: "allowed" });
    expect(describeAction(row({ tool: "reject_offer", actor: "merchant", arguments: { by: "owner@trailhead.test" }, agentReason: "It was delivered." }))).toMatchObject({
      title: "Rejected by owner@trailhead.test",
      detail: "Note to buyer: “It was delivered.”",
      tone: "denied",
    });
  });

  it("describes a dispute arriving from PayPal", () => {
    const e = describeAction(
      row({ tool: "dispute_opened", actor: "worker", arguments: { dispute_id: "PP-R-ABC-1", source: "poll" }, result: { stage: "inquiry", status: "WAITING_FOR_SELLER_RESPONSE", amount_cents: 64500 } }),
    );
    expect(e).toMatchObject({ title: "Buyer opened a PayPal inquiry for $645.00", detail: "PP-R-ABC-1 · waiting for seller response", tone: "error" });
  });

  it("falls back to the tool name for unknown tools", () => {
    expect(describeAction(row({ tool: "something_new" })).title).toBe("something new");
  });
});
