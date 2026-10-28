import { describe, expect, it } from "vitest";
import { matchStatementSnippet, normalizeDescriptor, parseStatementAmountCents, parseStatementDescriptor } from "./statement";

const order = {
  orderNumber: "FR-20002",
  amountCents: 12900,
  currency: "USD",
  softDescriptor: "TRAILHEAD FRPLY.CO/HLP",
  placedOn: "2026-10-20",
};

describe("parseStatementAmountCents", () => {
  it("reads $ amounts", () => {
    expect(parseStatementAmountCents("PAYPAL *TRAILHEAD $129.00")).toBe(12900);
  });
  it("reads USD suffix/prefix", () => {
    expect(parseStatementAmountCents("Charge 129.00 USD")).toBe(12900);
    expect(parseStatementAmountCents("USD 42.18")).toBe(4218);
  });
  it("returns null when no amount", () => {
    expect(parseStatementAmountCents("no money here")).toBeNull();
  });
});

describe("parseStatementDescriptor", () => {
  it("prefers PAYPAL * labels", () => {
    expect(parseStatementDescriptor("01 PAYPAL *TRAILHEAD FRPLY 129.00")).toMatch(/PAYPAL \*TRAILHEAD/i);
  });
});

describe("normalizeDescriptor", () => {
  it("strips paypal star and punctuation", () => {
    expect(normalizeDescriptor("PAYPAL *TRAILHEAD FRPLY.CO/HLP")).toBe("TRAILHEADFRPLYCOHLP");
  });
});

describe("matchStatementSnippet", () => {
  it("matches amount + descriptor as the same charge", () => {
    const m = matchStatementSnippet("PAYPAL *TRAILHEAD FRPLY.CO/HLP $129.00", order);
    expect(m.amountMatched).toBe(true);
    expect(m.descriptorMatched).toBe(true);
    expect(m.likelySameCharge).toBe(true);
  });

  it("flags amount mismatch", () => {
    const m = matchStatementSnippet("PAYPAL *OTHERSHOP $50.00", order);
    expect(m.amountMatched).toBe(false);
    expect(m.likelySameCharge).toBe(false);
  });

  it("treats order number + amount as enough", () => {
    const m = matchStatementSnippet(`I see FR-20002 for $129.00`, order);
    expect(m.orderNumberMentioned).toBe(true);
    expect(m.amountMatched).toBe(true);
    expect(m.likelySameCharge).toBe(true);
  });
});
