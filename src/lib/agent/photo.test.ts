import { describe, expect, it } from "vitest";
import { parseDataUrl, PhotoAssessmentSchema, validateBuyerImage } from "./photo";

describe("parseDataUrl / validateBuyerImage", () => {
  it("accepts a small PNG data URL", () => {
    // 1x1 transparent PNG
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const img = parseDataUrl(dataUrl);
    expect(img?.mediaType).toBe("image/png");
    expect(validateBuyerImage(img!)).toBeNull();
  });

  it("rejects non-images and empty payloads", () => {
    expect(parseDataUrl("data:text/plain;base64,aGVsbG8=")).toBeNull();
    expect(validateBuyerImage({ mediaType: "image/png", base64: "" })).toMatch(/empty/i);
  });

  it("rejects oversize base64", () => {
    const big = "A".repeat(6_000_000);
    expect(validateBuyerImage({ mediaType: "image/jpeg", base64: big })).toMatch(/4 MB/i);
  });
});

describe("PhotoAssessmentSchema", () => {
  it("accepts a well-formed assessment", () => {
    const parsed = PhotoAssessmentSchema.parse({
      severity: "minor",
      matches_listing: "yes",
      summary: "Scuff on the corner of the backpack.",
      suggested_fix: "partial_refund",
    });
    expect(parsed.severity).toBe("minor");
  });
});
