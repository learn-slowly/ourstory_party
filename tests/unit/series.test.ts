import { describe, it, expect } from "vitest";
import { toRechartsData, type ChartLine } from "../../src/lib/series";
import type { SeriesPoint } from "../../src/lib/queries";

const electionA = { id: "e1", date: "2022-06-01", type: "governor", name: "지선A", displayOrder: 1, isByelection: false };
const electionB = { id: "e2", date: "2024-04-10", type: "general", name: "총선B", displayOrder: 2, isByelection: false };

const SAMPLE: SeriesPoint[] = [
  { election: electionA, partyId: "justice", partyName: "정의당", partyColor: "#FFCC00", partyFamily: "justice", votes: 100, totalVotes: 1000, pct: 10.0 },
  { election: electionA, partyId: "labor", partyName: "노동당", partyColor: "#A50034", partyFamily: "labor", votes: 50, totalVotes: 1000, pct: 5.0 },
  { election: electionB, partyId: "justice", partyName: "정의당", partyColor: "#FFCC00", partyFamily: "justice", votes: 80, totalVotes: 1200, pct: 6.7 },
];

describe("toRechartsData", () => {
  it("election 행 + 정당 컬럼 wide 매트릭스 + lines 메타", () => {
    const { data, lines } = toRechartsData(SAMPLE);
    expect(data).toEqual([
      { electionId: "e1", electionLabel: "지선A", date: "2022-06-01", displayOrder: 1, justice: 10.0, labor: 5.0 },
      { electionId: "e2", electionLabel: "총선B", date: "2024-04-10", displayOrder: 2, justice: 6.7 },
    ]);
    expect(lines).toEqual<ChartLine[]>([
      { partyId: "justice", name: "정의당", color: "#FFCC00", family: "justice" },
      { partyId: "labor", name: "노동당", color: "#A50034", family: "labor" },
    ]);
  });

  it("displayOrder 순으로 정렬", () => {
    const reversed = [SAMPLE[2], SAMPLE[0], SAMPLE[1]];
    const { data } = toRechartsData(reversed);
    expect(data[0].electionId).toBe("e1");
    expect(data[1].electionId).toBe("e2");
  });
});
