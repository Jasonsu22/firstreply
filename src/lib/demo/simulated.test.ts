import { describe, expect, it } from "vitest";
import { isSimulatedPayment, isSimulatedRefundId } from "./simulated";

describe("simulated demo payments", () => {
  it("recognises only DEMO- captures", () => {
    expect(isSimulatedPayment({ paypalCaptureId: "DEMO-CAPTURE-123" })).toBe(true);
    expect(isSimulatedPayment({ paypalCaptureId: "5AP52534FP786445W" })).toBe(false);
    expect(isSimulatedPayment({ paypalCaptureId: null })).toBe(false); // seeded history stays blocked by policy
  });

  it("recognises simulated refund ids", () => {
    expect(isSimulatedRefundId("SIMULATED-AB12")).toBe(true);
    expect(isSimulatedRefundId("1Y685709GX806531J")).toBe(false);
    expect(isSimulatedRefundId(undefined)).toBe(false);
  });
});
