// tests/unit/build/format-detect.test.ts
import { describe, it, expect } from "vitest";
import { detectFormat } from "../../../scripts/build/lib/xlsx-format-detect";

describe("detectFormat", () => {
  it("A — 2024 지역구 통합", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx")).toBe("A");
  });
  it("B — 2020 영암 분리", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx")).toBe("B");
  });
  it("C — 2022 종로 재보궐", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx")).toBe("C");
  });
  it("D — 2012 대선 .xls", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-d-2012-presidential.xls")).toBe("D");
  });
});
