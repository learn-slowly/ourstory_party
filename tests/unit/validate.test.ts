import { describe, it, expect } from "vitest";
import { checkSumConsistency, checkDenominatorConsistency } from "../../scripts/ingest/validate";

describe("checkSumConsistency (R2)", () => {
  it("시·군 합 = 시·도 합계 ±0.5% 면 PASS", () => {
    const result = checkSumConsistency([
      { electionId: "e1", regionCode: "11", partyId: "p1", votes: 1000 },
      { electionId: "e1", regionCode: "1101", partyId: "p1", votes: 600 },
      { electionId: "e1", regionCode: "1102", partyId: "p1", votes: 400 },
    ], [
      { code: "11", level: "sido", parentCode: null },
      { code: "1101", level: "sigungu", parentCode: "11" },
      { code: "1102", level: "sigungu", parentCode: "11" },
    ]);
    expect(result.violations).toEqual([]);
  });

  it("델타 > 0.5% 면 위반", () => {
    const result = checkSumConsistency([
      { electionId: "e1", regionCode: "11", partyId: "p1", votes: 1000 },
      { electionId: "e1", regionCode: "1101", partyId: "p1", votes: 800 },
    ], [
      { code: "11", level: "sido", parentCode: null },
      { code: "1101", level: "sigungu", parentCode: "11" },
    ]);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].deltaPct).toBeGreaterThan(0.5);
  });
});

describe("checkDenominatorConsistency (R4)", () => {
  it("valid + invalid == total 이고 progress 0~100 이면 통과", () => {
    const result = checkDenominatorConsistency([
      { electionId: "e1", regionCode: "11", totalVoters: 100, totalVotes: 50, validVotes: 45, invalidVotes: 5 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("valid + invalid != total 이면 경고", () => {
    const result = checkDenominatorConsistency([
      { electionId: "e1", regionCode: "11", totalVoters: 100, totalVotes: 50, validVotes: 45, invalidVotes: 4 },
    ]);
    expect(result.warnings.length).toBe(1);
  });
});
