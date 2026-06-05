import { describe, it, expect } from "vitest";
import { buildElectionDetail } from "../../../scripts/build/lib/build-election-detail";
import { buildStations } from "../../../scripts/build/lib/build-station";
import { ParsedElection } from "../../../scripts/build/lib/types";

const parsed: ParsedElection = {
  electionId: "2024-general", electionDate: "2024-04-10",
  partyNames: ["더불어민주당\n곽상언", "국민의힘\n최재형"],
  rows: [
    { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: null, kind: "presub",
      totalVoters: 500, totalVotes: 500, validVotes: 495, invalidVotes: 5,
      parties: [{ rawName: "더불어민주당\n곽상언", votes: 250 }, { rawName: "국민의힘\n최재형", votes: 240 }] },
    { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제1투", kind: "el_day",
      totalVoters: 1000, totalVotes: 800, validVotes: 790, invalidVotes: 10,
      parties: [{ rawName: "더불어민주당\n곽상언", votes: 400 }, { rawName: "국민의힘\n최재형", votes: 390 }] },
  ],
};

describe("buildElectionDetail", () => {
  it("candidates 합 = sum of el_day rows", () => {
    const d = buildElectionDetail(
      "1111000000",
      (r) => r.sidoName === "서울특별시" && r.sigunguName === "종로구",
      parsed,
    );
    expect(d.candidates.find(c => c.partyId === "democratic")?.votes).toBe(400);
    expect(d.candidates.find(c => c.partyId === "people_power")?.votes).toBe(390);
  });
  it("rowsByEmd 구성 — 청운효자동 + presub + el_day", () => {
    const d = buildElectionDetail(
      "1111000000",
      (r) => r.sidoName === "서울특별시" && r.sigunguName === "종로구",
      parsed,
    );
    expect(d.rowsByEmd.length).toBe(1);
    const emd = d.rowsByEmd[0];
    expect(emd.emdName).toBe("청운효자동");
    const kinds = emd.kindRows.map(r => r.kind);
    expect(kinds).toContain("presub");
    expect(kinds).toContain("el_day");
  });
});

describe("buildStations", () => {
  it("station key 별 시계열 누적", () => {
    const stations = buildStations(new Map([["2024-general", parsed]]));
    // station key = sigungu-emd-name
    const key = "종로구-청운효자동-청운효자동제1투";
    const f = stations.get(key)!;
    expect(f).toBeDefined();
    expect(f.timeseries["democratic"][0].votes).toBe(400);
  });
});
