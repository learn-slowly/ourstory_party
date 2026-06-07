import { describe, it, expect } from "vitest";
import { parseSheetRowsForTest } from "./parse-jiseon-2022";
import * as XLSX from "xlsx";
import path from "node:path";

const FIXTURE = path.resolve("scripts/build/parsers/fixtures/sample-jiseon-2022.xlsx");
const wb = XLSX.readFile(FIXTURE);
const sheet = wb.Sheets[wb.SheetNames[0]];

// Layout A (시도지사/광역비례 형식): sido=0, sigungu=1, emd=2, gubun=3, voteStart=6
const LAYOUT_A = { sidoCol: 0, sigunguCol: 1, emdCol: 2, gubunCol: 3, voteStartCol: 6 };

describe("parse-jiseon-2022 — parseSheetRows", () => {
  const rows = parseSheetRowsForTest(sheet, LAYOUT_A);

  it("정상 emd 행 추출 — 더불어민주당 상남동 득표 수", () => {
    const r = rows.find((r) => r.emd === "상남동" && r.partyName === "더불어민주당");
    expect(r?.votes).toBe(4010);
  });

  it("정당 컬럼 3개 → 3 행씩 emd 마다", () => {
    const sangnam = rows.filter((r) => r.emd === "상남동");
    expect(sangnam.length).toBe(3);
    expect(sangnam.map((r) => r.partyName).sort()).toEqual(["국민의힘", "더불어민주당", "정의당"]);
  });

  it("'합계'·'거소투표'·'관내사전투표'·'선거일투표' 행은 skip", () => {
    expect(rows.find((r) => r.emd === "합계")).toBeUndefined();
    // gubun != "소계" 는 모두 skip
    const sangnam = rows.filter((r) => r.emd === "상남동");
    // 소계 1개 × 정당 3개 = 3개만 있어야
    expect(sangnam.length).toBe(3);
  });

  it("totalVotes 가 해당 소계 행의 정당 합", () => {
    const r = rows.find((r) => r.emd === "상남동" && r.partyName === "더불어민주당");
    // 4010 + 11482 + 726 = 16218
    expect(r?.totalVotes).toBe(4010 + 11482 + 726);
  });

  it("진주시 중앙동도 정상 (시·도/시·군 지정)", () => {
    const r = rows.find((r) => r.sigungu === "진주시" && r.emd === "중앙동" && r.partyName === "정의당");
    expect(r?.votes).toBe(390);
  });

  it("후보명 제거 — '더불어민주당\\r\\n송영길' → '더불어민주당'", () => {
    const r = rows.find((r) => r.emd === "상남동" && r.partyName === "더불어민주당");
    expect(r?.partyName).toBe("더불어민주당");
  });
});
