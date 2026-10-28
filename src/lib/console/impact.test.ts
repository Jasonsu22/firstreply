import { describe, expect, it } from "vitest";
import {
  DISPUTE_COST_MULTIPLIER,
  classifyRoute,
  computeImpact,
  formatMinutes,
  isPrevented,
  type ImpactCaseInput,
} from "./impact";

function row(partial: Partial<ImpactCaseInput> & Pick<ImpactCaseInput, "id">): ImpactCaseInput {
  return {
    status: "resolved",
    issueType: "not_received",
    trustTierAtOpen: "normal",
    orderAmountCents: 4500,
    openedAt: new Date("2026-10-01T10:00:00Z"),
    resolvedAt: new Date("2026-10-01T10:30:00Z"),
    hasDispute: false,
    door: "widget",
    route: "auto",
    ...partial,
  };
}

describe("isPrevented", () => {
  it("counts resolved cases with no linked dispute", () => {
    expect(isPrevented({ status: "resolved", hasDispute: false })).toBe(true);
    expect(isPrevented({ status: "closed", hasDispute: false })).toBe(true);
  });
  it("excludes open, disputed, and dispute-linked cases", () => {
    expect(isPrevented({ status: "open", hasDispute: false })).toBe(false);
    expect(isPrevented({ status: "resolved", hasDispute: true })).toBe(false);
    expect(isPrevented({ status: "disputed", hasDispute: true })).toBe(false);
  });
});

describe("classifyRoute", () => {
  it("labels escalated, approved, and auto resolutions", () => {
    expect(classifyRoute({ status: "escalated", hadApprovedApproval: false })).toBe("escalated");
    expect(classifyRoute({ status: "resolved", hadApprovedApproval: true })).toBe("approved");
    expect(classifyRoute({ status: "resolved", hadApprovedApproval: false })).toBe("auto");
    expect(classifyRoute({ status: "open", hadApprovedApproval: false })).toBe("other");
  });
});

describe("computeImpact", () => {
  it("applies the 5.13× multiplier to prevented order totals", () => {
    const stats = computeImpact([
      row({ id: "1", orderAmountCents: 10_000 }),
      row({ id: "2", orderAmountCents: 5_000, hasDispute: true, status: "disputed", route: "other" }),
      row({ id: "3", orderAmountCents: 2_000, status: "open", resolvedAt: null, route: "other" }),
    ]);
    expect(stats.disputesPrevented).toBe(1);
    expect(stats.preventedOrderCents).toBe(10_000);
    expect(stats.moneySavedCents).toBe(Math.round(10_000 * DISPUTE_COST_MULTIPLIER));
    expect(stats.disputedCount).toBe(1);
    expect(stats.openCount).toBe(1);
  });

  it("averages resolve time and breaks down by door / issue / tier / route", () => {
    const stats = computeImpact([
      row({
        id: "a",
        openedAt: new Date("2026-10-01T10:00:00Z"),
        resolvedAt: new Date("2026-10-01T10:20:00Z"),
        door: "widget",
        issueType: "not_received",
        trustTierAtOpen: "trusted",
        route: "auto",
      }),
      row({
        id: "b",
        openedAt: new Date("2026-10-01T10:00:00Z"),
        resolvedAt: new Date("2026-10-01T11:00:00Z"),
        door: "hosted_page",
        issueType: "damaged",
        trustTierAtOpen: "watch",
        route: "approved",
        orderAmountCents: 8900,
      }),
      row({
        id: "c",
        status: "escalated",
        resolvedAt: null,
        door: null,
        route: "escalated",
        orderAmountCents: 3200,
      }),
    ]);
    expect(stats.avgMinutesToResolve).toBe(40); // (20 + 60) / 2
    expect(stats.disputesPrevented).toBe(2);
    expect(stats.byRoute.map((r) => r.key).sort()).toEqual(["approved", "auto", "escalated"]);
    expect(stats.byDoor.find((d) => d.key === "seeded")?.count).toBe(1);
    expect(stats.byIssue.find((i) => i.key === "damaged")?.count).toBe(1);
    expect(stats.byTier.find((t) => t.key === "trusted")?.count).toBe(1);
  });
});

describe("formatMinutes", () => {
  it("formats short and long durations", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(12)).toBe("12 min");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(120)).toBe("2h");
  });
});
