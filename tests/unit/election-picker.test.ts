import { describe, it, expect } from "vitest";
import { buildRegionUrl } from "../../src/components/region/election-picker-url";

describe("buildRegionUrl", () => {
  it("일반 케이스 — code + electionId", () => {
    expect(buildRegionUrl("4817000000", "2024-general-prop")).toBe(
      "/region/4817000000?election=2024-general-prop",
    );
  });

  it("electionId 에 특수문자 — encodeURIComponent 가 실제 인코딩 수행", () => {
    // 가상의 ID 로 공백·+ 같은 reserved char 처리 확인 (실제 ID 슬러그엔 없지만 헬퍼 견고성 검증)
    expect(buildRegionUrl("4817000000", "2024 general+prop")).toBe(
      "/region/4817000000?election=2024%20general%2Bprop",
    );
  });

  it("synthetic 행정동 code — 9 prefix", () => {
    expect(buildRegionUrl("9171000001", "2024-general-prop")).toBe(
      "/region/9171000001?election=2024-general-prop",
    );
  });
});
