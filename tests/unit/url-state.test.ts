import { describe, it, expect } from "vitest";
import { parseSearchParams, encodeState, type HomeState } from "../../src/lib/url-state";

const DEFAULT: HomeState = {
  region: "all",
  types: "all",
  parties: ["justice", "labor", "green", "progressive"],
  satellite: "split",
  mergeProgressive: false,
  from: null,
  to: null,
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
      from: null,
      to: null,
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

  it("from/to YYYY 파싱 + 범위 밖·잘못된 형식 거부", () => {
    expect(parseSearchParams({ from: "2020", to: "2025" }).from).toBe("2020");
    expect(parseSearchParams({ from: "2020", to: "2025" }).to).toBe("2025");
    expect(parseSearchParams({ from: "20" }).from).toBe(null);
    expect(parseSearchParams({ from: "2030" }).from).toBe(null);
    expect(parseSearchParams({ to: "1900" }).to).toBe(null);
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

  it("from/to 가 있으면 query 에 포함", () => {
    expect(encodeState({ ...DEFAULT, from: "2020", to: "2025" }))
      .toBe("from=2020&to=2025");
  });
});
