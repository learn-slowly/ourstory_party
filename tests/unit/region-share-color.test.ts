import { describe, it, expect } from "vitest";
import { justiceShareColor } from "../../src/lib/region-share-color";

describe("justiceShareColor", () => {
  it("share=0 → 투명 (#FFCC0000)", () => {
    expect(justiceShareColor(0)).toBe("#FFCC0000");
  });
  it("share=0.05 → 중간 알파 (대략 7f~80)", () => {
    const c = justiceShareColor(0.05);
    expect(c.startsWith("#FFCC00")).toBe(true);
    const a = parseInt(c.slice(-2), 16);
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(160);
  });
  it("share≥0.1 → max 알파 (#FFCC00ff)", () => {
    expect(justiceShareColor(0.1)).toBe("#FFCC00ff");
    expect(justiceShareColor(0.5)).toBe("#FFCC00ff");
  });
});
