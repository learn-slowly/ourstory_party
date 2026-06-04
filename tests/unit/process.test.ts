import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractVoteTotals,
  extractRegionTotals,
  extractCandidates,
  isAggregateRow,
  expandCells,
} from "../../scripts/ingest/process";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function loadFixture(name: string) {
  return JSON.parse(await readFile(path.join(HERE, "..", "fixtures", "raw", name), "utf-8"));
}

describe("isAggregateRow", () => {
  it("wiwName=합계 면 true", () => {
    expect(isAggregateRow({ sdName: "서울특별시", wiwName: "합계" })).toBe(true);
  });
  it("시·군명이면 false", () => {
    expect(isAggregateRow({ sdName: "서울특별시", wiwName: "종로구" })).toBe(false);
  });
});

describe("expandCells", () => {
  it("jd01~jd50 행을 후보자 단위 셀로 펼친다", () => {
    const row = {
      jd01: "더불어민주당", hbj01: "이재명", dugsu01: 100,
      jd02: "국민의힘", hbj02: "김문수", dugsu02: 80,
      jd03: "", hbj03: "", dugsu03: 0,  // 빈 끝
    };
    const cells = expandCells(row);
    expect(cells.length).toBe(2);
    expect(cells[0]).toEqual({ jd: "더불어민주당", hbj: "이재명", dugsu: 100 });
  });
});

describe("extractVoteTotals (정당 단위 집계)", () => {
  it("픽스처에서 (sdName, wiwName, jdName) 키로 합산된 행 다수", async () => {
    const rows = await loadFixture("vote-xmntck-presidential.json");
    const result = extractVoteTotals(rows);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({
      sdName: expect.any(String),
      wiwName: expect.any(String),
      jdName: expect.any(String),
      votes: expect.any(Number),
    });
    // 합계|합계 행에 정당 한 개당 1개 row 있어야 함
    const total = result.filter((r) => r.sdName === "합계" && r.wiwName === "합계");
    expect(total.length).toBeGreaterThan(0);
  });
});

describe("extractRegionTotals (분모, wide row 의 sunsu/tusu/yutusu/mutusu)", () => {
  it("wide row 에서 분모 도출", async () => {
    const rows = await loadFixture("vote-xmntck-presidential.json");
    const result = extractRegionTotals(rows);
    expect(result.length).toBe(rows.length);
    expect(result.some((r) => r.totalVoters != null && r.totalVotes != null)).toBe(true);
  });
});

describe("extractCandidates (후보자)", () => {
  it("합계 행 제외, 후보자 단위 행 생성", async () => {
    const rows = await loadFixture("vote-xmntck-presidential.json");
    const result = extractCandidates(rows);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({
      constituency: expect.any(String),
      name: expect.any(String),
      partyNameRaw: expect.any(String),
      votes: expect.any(Number),
    });
    // 합계 행 제외 확인 — wiwName='합계' 인 행에서 온 후보자는 없어야 함
    const fromAggregate = result.filter((r) => r.constituency === "합계");
    expect(fromAggregate.length).toBe(0);
  });
});
