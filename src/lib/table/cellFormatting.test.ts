import { describe, it, expect } from "vitest";
import { justiceCellBg, partyHeaderStyle, formatCell } from "./cellFormatting";

describe("justiceCellBg — 정의당 % → 노란색 알파", () => {
  it("0 또는 null → transparent", () => {
    expect(justiceCellBg(0)).toBe("transparent");
    expect(justiceCellBg(null)).toBe("transparent");
  });
  it("10% → 중간 농도, 50%+ → 진한 농도", () => {
    expect(justiceCellBg(10)).toMatch(/^rgba\(255, 204, 0, 0\.[12]\d*\)$/);
    expect(justiceCellBg(50)).toMatch(/^rgba\(255, 204, 0, 0\.[6789]\d*\)$/);
  });
});

describe("partyHeaderStyle — 정당색 strip", () => {
  it("정당색 → borderTopColor·borderTopWidth 3", () => {
    expect(partyHeaderStyle("#004EA2")).toEqual({ borderTopColor: "#004EA2", borderTopWidth: 3 });
  });
  it("undefined 색 → 빈 객체", () => {
    expect(partyHeaderStyle(undefined)).toEqual({});
  });
});

describe("formatCell — 셀 표시 텍스트", () => {
  it("숫자 → 소수 1자리 + %", () => expect(formatCell(5.347)).toBe("5.3%"));
  it("0 → 0.0%", () => expect(formatCell(0)).toBe("0.0%"));
  it("null → '—'", () => expect(formatCell(null)).toBe("—"));
});
