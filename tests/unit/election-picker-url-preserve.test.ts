import { describe, it, expect } from "vitest";
import { buildRegionUrl } from "../../src/components/region/election-picker-url";

describe("buildRegionUrl with currentSearch", () => {
  it("currentSearch 미지정 — 기존 시그니처 호환", () => {
    expect(buildRegionUrl("4817000000", "20240410")).toBe(
      "/region/4817000000?election=20240410",
    );
  });

  it("currentSearch 의 시계열 키 보존 — parties/satellite/merge_prog/types/from/to", () => {
    const params = new URLSearchParams("parties=justice,labor&satellite=merged&merge_prog=1");
    const url = buildRegionUrl("4817000000", "20240410", params);
    expect(url).toContain("/region/4817000000?");
    expect(url).toContain("election=20240410");
    expect(url).toContain("parties=justice%2Clabor");
    expect(url).toContain("satellite=merged");
    expect(url).toContain("merge_prog=1");
  });

  it("currentSearch 에 election 이 이미 있으면 새 값으로 덮어쓰기", () => {
    const params = new URLSearchParams("election=20200415&parties=justice");
    const url = buildRegionUrl("4817000000", "20240410", params);
    expect(url).toContain("election=20240410");
    expect(url).not.toContain("election=20200415");
  });

  it("synthetic 행정동 code (9 prefix) — 그대로 인코딩", () => {
    expect(buildRegionUrl("9171000001", "20240410")).toBe(
      "/region/9171000001?election=20240410",
    );
  });
});
