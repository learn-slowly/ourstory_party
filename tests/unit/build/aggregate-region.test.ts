import { describe, it, expect } from "vitest";
import { aggregateByRegion } from "../../../scripts/build/lib/aggregate-region";
import { ParsedStationRow } from "../../../scripts/build/lib/types";

// 종로구 청운효자동의 station 2개 + 강남구 역삼1동의 station 1개
const sample: ParsedStationRow[] = [
  { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제1투", kind: "el_day",
    totalVoters: 1000, totalVotes: 800, validVotes: 790, invalidVotes: 10,
    parties: [{ rawName: "더불어민주당\n곽상언", votes: 400 }, { rawName: "국민의힘\n최재형", votes: 390 }] },
  { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제2투", kind: "el_day",
    totalVoters: 500, totalVotes: 400, validVotes: 395, invalidVotes: 5,
    parties: [{ rawName: "더불어민주당\n곽상언", votes: 200 }, { rawName: "국민의힘\n최재형", votes: 195 }] },
  { sidoName: "서울특별시", sigunguName: "강남구", emdName: "역삼1동", stationName: "역삼1동제1투", kind: "el_day",
    totalVoters: 800, totalVotes: 600, validVotes: 590, invalidVotes: 10,
    parties: [{ rawName: "더불어민주당\n곽상언", votes: 250 }, { rawName: "국민의힘\n최재형", votes: 340 }] },
];

describe("aggregateByRegion", () => {
  it("emd 합 = station 합 (종로구 청운효자동)", () => {
    const out = aggregateByRegion(sample, "2024-04-10", "2024-general");
    const emd = out.emd.get("서울특별시|종로구|청운효자동")!;
    expect(emd.totalVoters).toBe(1500);
    expect(emd.byParty.find(p => p.rawName.startsWith("더불어민주당"))?.votes).toBe(600);
  });
  it("sigungu 합 = emd 합 (종로구)", () => {
    const out = aggregateByRegion(sample, "2024-04-10", "2024-general");
    const sg = out.sigungu.get("서울특별시|종로구")!;
    expect(sg.totalVoters).toBe(1500);
    expect(sg.byParty.find(p => p.rawName.startsWith("더불어민주당"))?.votes).toBe(600);
  });
  it("sido 합 = 모든 sigungu 합 (서울)", () => {
    const out = aggregateByRegion(sample, "2024-04-10", "2024-general");
    const sido = out.sido.get("서울특별시")!;
    expect(sido.totalVoters).toBe(2300);
    expect(sido.byParty.find(p => p.rawName.startsWith("더불어민주당"))?.votes).toBe(850);
  });
  it("el_day 만 집계 — total/subtotal 행 제외", () => {
    const withMeta: ParsedStationRow[] = [
      ...sample,
      { sidoName: "서울특별시", sigunguName: "종로구", emdName: null, stationName: null, kind: "total",
        totalVoters: 9999, totalVotes: 9999, validVotes: 9999, invalidVotes: 0, parties: [] },
    ];
    const out = aggregateByRegion(withMeta, "2024-04-10", "2024-general");
    expect(out.sigungu.get("서울특별시|종로구")!.totalVoters).toBe(1500); // 9999 미포함
  });
  it("partyId 매핑 — democratic·people_power", () => {
    const out = aggregateByRegion(sample, "2024-04-10", "2024-general");
    const emd = out.emd.get("서울특별시|종로구|청운효자동")!;
    expect(emd.byParty.find(p => p.rawName.startsWith("더불어민주당"))?.partyId).toBe("democratic");
    expect(emd.byParty.find(p => p.rawName.startsWith("국민의힘"))?.partyId).toBe("people_power");
  });
});
