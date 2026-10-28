import { describe, expect, it } from "vitest";
import { SCENARIOS, runAllDeterministic, runDeterministicScenario } from "./scenarios";

describe("scenario eval catalog", () => {
  it("has at least 20 scenarios including injection and live ones", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
    expect(SCENARIOS.some((s) => s.id.startsWith("INJ-"))).toBe(true);
    expect(SCENARIOS.some((s) => s.kind === "live")).toBe(true);
  });

  it("every deterministic scenario passes", () => {
    const { results, failed, passed, total } = runAllDeterministic();
    for (const r of results) {
      expect(r.ok, `${r.id}: ${r.detail}`).toBe(true);
    }
    expect(failed).toBe(0);
    expect(passed).toBe(total);
    expect(total).toBeGreaterThanOrEqual(18);
  });

  it("live scenarios are skipped by the deterministic runner", () => {
    const live = SCENARIOS.find((s) => s.kind === "live")!;
    const r = runDeterministicScenario(live);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/skipped/i);
  });
});
