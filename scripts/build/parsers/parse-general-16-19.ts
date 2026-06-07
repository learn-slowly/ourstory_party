// scripts/build/parsers/parse-general-16-19.ts
// 17대(2004) + 18대(2008) 국회의원선거 파서
// (16대 2000년은 단일 XLS에 모든 투표구가 섞인 특수 구조라 시군구 매핑 불가 — skip)
// (19대 2012은 이미 parsed에 있음 — skip)
//
// 17대 지역구 구조 (per-sido xls, sheet=선거구):
//   row0: [투표구명 | 선거인수 | 투표수 | 후보자별 득표수... | 무효 | 기권수]
//   row1: [_ | _ | _ | 정당1 | 정당2 | ... | 계 | 투표수 | _]
//   row2: [_ | _ | _ | 후보1 | 후보2 | ... | _ | _ | _]
//   row3+: 합계 / 부재자 / 소계(읍면동) / 투표구
//
// 17대 비례 구조 (per-sido xls, sheet=선거구):
//   row0: [투표구명 | 선거인수 | 투표수 | 정당별 득표상황... | 무효 | 기권수]
//   row1: [_ | _ | _ | 정당1 | 정당2 | ... | 계 | 투표수 | _]
//   row2: [합계 | ...] (바로 데이터 시작)
//
// 18대 지역구 구조 (per-sido xls, sheet=선거구):
//   row0: [읍면동명 | 투표구명 | 선거인수 | 투표수 | 후보자별 득표상황... | 무효 | 기권수]
//   row1: [_ | _ | _ | _ | 정당1 | 정당2 | ... | 계 | 투표수 | _]
//   row2: [_ | _ | _ | _ | 후보1 | 후보2 | ... | _ | _ | _]
//   row3+: 합계 / 부재자 / 읍면동명(소계) / 투표구 rows

import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ParsedElection, ParsedStationRow } from "../lib/types";

function dec(raw: Buffer): string {
  try { return iconv.decode(raw, "cp949"); } catch { return raw.toString("utf-8"); }
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── 17대 지역구 parser ────────────────────────────────────────────────
// sheet name = 선거구명 (e.g. "종로구")
// col0=투표구명, col1=선거인수, col2=투표수, col3..N-3=party/candidate, N-2=계, N-1=투표수(무효)?, last=기권수
function parse17GeneralSheet(
  sheet: XLSX.WorkSheet,
  sidoName: string,
  sigunguName: string,  // 시트이름에서
  isProportional: boolean
): ParsedStationRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // row1: party names (col3+). Find last "계" to determine end
  const partyRow = json[1] as (string | null)[];
  let endCol = partyRow.length - 1;
  // find rightmost "계" which marks end of party columns
  for (let i = partyRow.length - 1; i >= 3; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 3; i < endCol; i++) {
    const n = partyRow[i];
    if (!n || typeof n !== "string") continue;
    const cleaned = n.trim().replace(/\s+/g, "");
    if (!cleaned || cleaned === "계") continue;
    partyCols.push({ idx: i, name: n.trim() });
  }

  if (partyCols.length === 0) return [];

  // For 지역구: row2 has candidate names → extract party from row1
  // For 비례: row2 is already data (합계 row)

  const dataStartRow = isProportional ? 2 : 3;

  const result: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = dataStartRow; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const col0 = String(row[0] ?? "").trim();
    if (!col0) continue;

    const voters = toNum(row[1]);
    const votes = toNum(row[2]);

    // 합계 행 → sigungu total
    if (col0 === "합계") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "total",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: votes - validVotes,
        parties,
      });
      continue;
    }

    // 부재자 행
    if (col0 === "부재자") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "absentee",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: votes - validVotes,
        parties,
      });
      continue;
    }

    // 소계 행 (읍면동 합계) — 소계 다음 투표구 행에서 emd 이름 추출
    if (col0 === "소계") {
      // Look ahead to find emd name from next station row (e.g., "반송동제1투" → "반송동")
      let emdName = currentEmd;
      for (let k = r + 1; k < Math.min(json.length, r + 3); k++) {
        const nextRow = json[k];
        if (!nextRow) continue;
        const nextCol0 = String(nextRow[0] ?? "").trim();
        if (!nextCol0 || nextCol0 === "소계" || nextCol0 === "합계") break;
        // Extract emd from station name: "반송동제1투" → "반송동"
        const emdMatch = nextCol0.match(/^(.+?)(?:제\d+투|제\d+|투표소)/);
        if (emdMatch) { emdName = emdMatch[1]; break; }
      }
      if (!emdName) { currentEmd = undefined; continue; }

      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName, stationName: null,
        kind: "subtotal",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: votes - validVotes,
        parties,
      });
      currentEmd = emdName;
      continue;
    }

    // 투표구 행 — skip (station-level not needed)
    if (voters > 0 && votes > 0) continue;
  }

  return result;
}

// ── 18대 지역구 parser ────────────────────────────────────────────────
// col0=읍면동명, col1=투표구명, col2=선거인수, col3=투표수, col4..=parties
function parse18GeneralSheet(
  sheet: XLSX.WorkSheet,
  sidoName: string,
  sigunguName: string
): ParsedStationRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // row1: party names starting from col4
  const partyRow = json[1] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 4; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 4; i < endCol; i++) {
    const n = partyRow[i];
    if (!n || typeof n !== "string") continue;
    const cleaned = n.trim().replace(/\s+/g, "");
    if (!cleaned || cleaned === "계") continue;
    partyCols.push({ idx: i, name: n.trim() });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const emdCell = String(row[0] ?? "").trim();
    const stationCell = String(row[1] ?? "").trim();
    const voters = toNum(row[2]);
    const votes = toNum(row[3]);

    if (!emdCell && !stationCell) continue;

    // 합계 행
    if (emdCell === "합계" || stationCell === "합계") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "total",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // 부재자 행
    if (emdCell === "부재자" || stationCell === "부재자") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "absentee",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // emdCell이 있고 stationCell가 없으면 읍면동명 업데이트
    if (emdCell && !stationCell) {
      currentEmd = emdCell;
      continue;
    }

    // stationCell = "소계" → 읍면동 합계
    if (stationCell === "소계" || stationCell === "") {
      if (emdCell) currentEmd = emdCell;
      if (currentEmd) {
        const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
          .filter(p => p.votes > 0);
        if (parties.length === 0) continue;
        const validVotes = parties.reduce((a, b) => a + b.votes, 0);
        result.push({
          sidoName, sigunguName, emdName: currentEmd, stationName: null,
          kind: "subtotal",
          totalVoters: voters, totalVotes: votes,
          validVotes, invalidVotes: Math.max(0, votes - validVotes),
          parties,
        });
      }
    }
    // else: 투표구명(el_day) — skip
  }

  return result;
}

// ── 시도명 정규화 ─────────────────────────────────────────────────────
function normalizeSidoName(rawFilename: string): string {
  const map: Record<string, string> = {
    "01 서울": "서울특별시",
    "02 부산": "부산광역시",
    "03 대구": "대구광역시",
    "04 인천": "인천광역시",
    "05 광주": "광주광역시",
    "06 대전": "대전광역시",
    "07 울산": "울산광역시",
    "08 경기": "경기도",
    "09 강원": "강원도",
    "10 충북": "충청북도",
    "11 충남": "충청남도",
    "12 전북": "전라북도",
    "13 전남": "전라남도",
    "14 경북": "경상북도",
    "15 경남": "경상남도",
    "16 제주": "제주특별자치도",
  };
  for (const [k, v] of Object.entries(map)) {
    if (rawFilename.includes(k)) return v;
  }
  return rawFilename;
}

function normalizeSido18(rawFilename: string): string {
  const map: Record<string, string> = {
    서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시",
    인천: "인천광역시", 광주: "광주광역시", 대전: "대전광역시",
    울산: "울산광역시", 경기: "경기도", 강원: "강원도",
    충북: "충청북도", 충남: "충청남도", 전북: "전라북도",
    전남: "전라남도", 경북: "경상북도", 경남: "경상남도",
    제주: "제주특별자치도",
  };
  for (const [k, v] of Object.entries(map)) {
    if (rawFilename.includes(k)) return v;
  }
  return rawFilename;
}

// ── 17대 총선 파서 ─────────────────────────────────────────────────────
export function parse2004General(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner17 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("17대") && n.endsWith(".zip");
  });
  if (!inner17) throw new Error("17대 zip not found");

  const zip17 = new AdmZip(inner17.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of zip17.getEntries()) {
    const name = dec(Buffer.from(entry.rawEntryName));
    if (!name.includes("지역구") || !name.endsWith(".xls")) continue;
    if (entry.isDirectory) continue;

    const sidoName = normalizeSidoName(name);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = parse17GeneralSheet(sheet, sidoName, sheetName, false);
      for (const r of rows) {
        r.parties.forEach(p => partySet.add(p.rawName));
        allRows.push(r);
      }
    }
  }

  return {
    electionId: "2004-general",
    electionDate: "2004-04-15",
    rows: allRows,
    partyNames: [...partySet],
  };
}

export function parse2004GeneralProp(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner17 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("17대") && n.endsWith(".zip");
  });
  if (!inner17) throw new Error("17대 zip not found");

  const zip17 = new AdmZip(inner17.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of zip17.getEntries()) {
    const name = dec(Buffer.from(entry.rawEntryName));
    if (!name.includes("비례대표") || !name.endsWith(".xls")) continue;
    if (entry.isDirectory) continue;

    const sidoName = normalizeSidoName(name);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = parse17GeneralSheet(sheet, sidoName, sheetName, true);
      for (const r of rows) {
        r.parties.forEach(p => partySet.add(p.rawName));
        allRows.push(r);
      }
    }
  }

  return {
    electionId: "2004-general-prop",
    electionDate: "2004-04-15",
    rows: allRows,
    partyNames: [...partySet],
  };
}

// ── 18대 총선 파서 ─────────────────────────────────────────────────────
export function parse2008General(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner18 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("18대") && n.endsWith(".zip");
  });
  if (!inner18) throw new Error("18대 zip not found");

  const zip18 = new AdmZip(inner18.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of zip18.getEntries()) {
    const name = dec(Buffer.from(entry.rawEntryName));
    if (!name.includes("지역구") || !name.endsWith(".xls")) continue;
    if (entry.isDirectory) continue;

    const sidoName = normalizeSido18(name);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = parse18GeneralSheet(sheet, sidoName, sheetName);
      for (const r of rows) {
        r.parties.forEach(p => partySet.add(p.rawName));
        allRows.push(r);
      }
    }
  }

  return {
    electionId: "2008-general",
    electionDate: "2008-04-09",
    rows: allRows,
    partyNames: [...partySet],
  };
}

// 18대 비례 — 17대 비례와 동일 구조지만 18대 zip 내 비례 폴더를 찾아야 함
// 실제로는 별도 파일이 없음 — 18대 zip에는 지역구만 있음
// 비례대표 개표자료는 별도 파일 없이 지역구 zip에만 포함됨
// → 18대 비례는 skip (데이터 없음)
export function parse2008GeneralProp(zipPath: string): ParsedElection {
  // 18대 총선 비례 데이터는 16~19대 zip에 없음
  return {
    electionId: "2008-general-prop",
    electionDate: "2008-04-09",
    rows: [],
    partyNames: [],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const zipPath = "/Users/ahbaik/Downloads/국회의원선거 개표결과(제16대~19대).zip";
  const outDir = "data/parsed";
  mkdirSync(outDir, { recursive: true });

  console.log("▶ 2004-general...");
  const g2004 = parse2004General(zipPath);
  console.log(`  rows=${g2004.rows.length}  parties=${g2004.partyNames.length}`);
  writeFileSync(path.join(outDir, "2004-general.json"), JSON.stringify(g2004));

  console.log("▶ 2004-general-prop...");
  const g2004p = parse2004GeneralProp(zipPath);
  console.log(`  rows=${g2004p.rows.length}  parties=${g2004p.partyNames.length}`);
  writeFileSync(path.join(outDir, "2004-general-prop.json"), JSON.stringify(g2004p));

  console.log("▶ 2008-general...");
  const g2008 = parse2008General(zipPath);
  console.log(`  rows=${g2008.rows.length}  parties=${g2008.partyNames.length}`);
  writeFileSync(path.join(outDir, "2008-general.json"), JSON.stringify(g2008));

  console.log("Done.");
}
