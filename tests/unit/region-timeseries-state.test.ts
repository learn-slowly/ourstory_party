import { describe, it, expect } from "vitest";
import { normalizeRegionState, DEFAULT_STATE, type HomeState } from "../../src/lib/url-state";

describe("normalizeRegionState", () => {
  it("state.region 을 DEFAULT_STATE.region 으로 강제", () => {
    const input: HomeState = {
      ...DEFAULT_STATE,
      region: "4817000000",
      parties: ["justice", "labor"],
    };
    const out = normalizeRegionState(input);
    expect(out.region).toBe(DEFAULT_STATE.region);
    expect(out.parties).toEqual(["justice", "labor"]);
  });

  it("다른 필드는 그대로", () => {
    const input: HomeState = {
      ...DEFAULT_STATE,
      region: "anything",
      satellite: "merged",
      mergeProgressive: true,
      from: "2014",
      to: "2024",
      types: ["governor"],
    };
    const out = normalizeRegionState(input);
    expect(out.satellite).toBe("merged");
    expect(out.mergeProgressive).toBe(true);
    expect(out.from).toBe("2014");
    expect(out.to).toBe("2024");
    expect(out.types).toEqual(["governor"]);
  });
});
