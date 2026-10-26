import { describe, expect, it } from "vitest";
import { BUYER_GUIDANCE } from "./guidance";

describe("buyer guidance", () => {
  it.each(Object.entries(BUYER_GUIDANCE))("%s never leaks limits, amounts or risk labels", (_code, text) => {
    expect(text).not.toMatch(/\$|\d|limit|tier|watch|high risk|flag|policy engine/i);
  });
});
