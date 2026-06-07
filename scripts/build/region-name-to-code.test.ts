import { describe, it, expect } from "vitest";
import { buildRegionNameLookup, lookupRegion } from "./region-name-to-code";

const fakeIndex = {
  regions: {
    sido: [
      { code: "4800000000", name: "경상남도" },
      { code: "1100000000", name: "서울특별시" },
    ],
    sigunguByRegion: {
      "4800000000": [
        { code: "4812000000", name: "창원시" },
        { code: "4817000000", name: "진주시" },
      ],
      "1100000000": [
        { code: "1117000000", name: "용산구" },
      ],
    },
    emdByRegion: {
      "4812000000": [
        { code: "4812011000", name: "상남동" },
        { code: "4812060000", name: "중앙동" },
      ],
      "4817000000": [
        { code: "4817056000", name: "문산읍" },
        { code: "4817099000", name: "중앙동" }, // 진주에도 중앙동
      ],
    },
  },
};

describe("buildRegionNameLookup", () => {
  it("시·도 이름으로 코드", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "경상남도" })).toBe("4800000000");
  });

  it("시·군·구는 시·도 경로 필요", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "경상남도", sigungu: "창원시" })).toBe("4812000000");
  });

  it("읍·면·동은 시·군·구 경로로 disambiguate", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "경상남도", sigungu: "창원시", emd: "중앙동" })).toBe("4812060000");
    expect(lookupRegion(l, { sido: "경상남도", sigungu: "진주시", emd: "중앙동" })).toBe("4817099000");
  });

  it("미존재 → null", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "전라남도" })).toBeNull();
  });

  it("공백 정규화 (trim)", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: " 경상남도 ", sigungu: " 창원시 " })).toBe("4812000000");
  });
});
