import { describe, it, expect } from "vitest";
import { parseSearchParams, encodeState, type HomeState } from "../../src/lib/url-state";

const DEFAULT: HomeState = {
  region: "all",
  types: "all",
  parties: ["justice", "labor", "green", "progressive"],
  satellite: "split",
  mergeProgressive: false,
};

describe("parseSearchParams", () => {
  it("빈 params 면 기본값 반환", () => {
    expect(parseSearchParams({})).toEqual(DEFAULT);
  });

  it("region/types/parties/satellite/merge_prog 파싱", () => {
    expect(parseSearchParams({
      region: "48",
      types: "governor,general_prop",
      parties: "justice,labor",
      satellite: "merged",
      merge_prog: "1",
    })).toEqual({
      region: "48",
      types: ["governor", "general_prop"],
      parties: ["justice", "labor"],
      satellite: "merged",
      mergeProgressive: true,
    });
  });

  it("base64url 압축 상태 ?s= 디코딩", () => {
    const json = JSON.stringify({ region: "48", parties: ["justice"], satellite: "merged" });
    const s = Buffer.from(json).toString("base64url");
    const parsed = parseSearchParams({ s });
    expect(parsed.region).toBe("48");
    expect(parsed.parties).toEqual(["justice"]);
    expect(parsed.satellite).toBe("merged");
  });
});

describe("encodeState", () => {
  it("기본값은 빈 query 로", () => {
    expect(encodeState(DEFAULT)).toBe("");
  });

  it("non-default 만 query 에 포함", () => {
    expect(encodeState({ ...DEFAULT, region: "48", mergeProgressive: true }))
      .toBe("region=48&merge_prog=1");
  });
});
