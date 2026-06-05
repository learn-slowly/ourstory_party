// tests/unit/build/build-region.test.ts
import { describe, it, expect } from "vitest";
import { buildRegionFiles } from "../../../scripts/build/lib/build-region";
import { ParsedElection } from "../../../scripts/build/lib/types";

const parsed: ParsedElection = {
  electionId: "2024-general", electionDate: "2024-04-10",
  partyNames: ["더불어민주당\n곽상언", "국민의힘\n최재형"],
  rows: [
    { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제1투", kind: "el_day",
      totalVoters: 1000, totalVotes: 800, validVotes: 790, invalidVotes: 10,
      parties: [{ rawName: "더불어민주당\n곽상언", votes: 400 }, { rawName: "국민의힘\n최재형", votes: 390 }] },
  ],
};

const regionCodeMap = new Map<string, string>([
  ["서울특별시", "1100000000"],
  ["서울특별시|종로구", "1111000000"],
  ["서울특별시|종로구|청운효자동", "1111051500"],
]);

describe("buildRegionFiles", () => {
  it("3 단계 region 파일 생성 (sido·sigungu·emd)", async () => {
    const out = await buildRegionFiles({
      elections: [{ id: "2024-general", date: "2024-04-10" }],
      parsedByElection: new Map([["2024-general", parsed]]),
      regionCodeMap,
    });
    expect(out.has("1100000000")).toBe(true);  // sido
    expect(out.has("1111000000")).toBe(true);  // sigungu
    expect(out.has("1111051500")).toBe(true);  // emd
  });
  it("종로구 level/parent/elections summary", async () => {
    const out = await buildRegionFiles({
      elections: [{ id: "2024-general", date: "2024-04-10" }],
      parsedByElection: new Map([["2024-general", parsed]]),
      regionCodeMap,
    });
    const sg = out.get("1111000000")!;
    expect(sg.level).toBe("sigungu");
    expect(sg.parent?.name).toBe("서울특별시");
    expect(sg.elections[0].electionId).toBe("2024-general");
    expect(sg.elections[0].byParty.find(p => p.partyId === "democratic")?.votes).toBe(400);
  });
  it("timeseries 매핑 — democratic·people_power", async () => {
    const out = await buildRegionFiles({
      elections: [{ id: "2024-general", date: "2024-04-10" }],
      parsedByElection: new Map([["2024-general", parsed]]),
      regionCodeMap,
    });
    const sg = out.get("1111000000")!;
    expect(sg.timeseries["democratic"]).toBeDefined();
    expect(sg.timeseries["democratic"][0].votes).toBe(400);
    expect(sg.timeseries["democratic"][0].share).toBeCloseTo(50.63, 1);  // 400/790
  });
  it("share 계산 — validVotes 분모", async () => {
    const out = await buildRegionFiles({
      elections: [{ id: "2024-general", date: "2024-04-10" }],
      parsedByElection: new Map([["2024-general", parsed]]),
      regionCodeMap,
    });
    const emd = out.get("1111051500")!;
    expect(emd.elections[0].byParty.find(p => p.partyId === "people_power")?.share).toBeCloseTo(49.37, 1); // 390/790
  });
});
