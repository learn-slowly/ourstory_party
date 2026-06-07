// scripts/build/parsers/parse-presidential-14-18.ts
// 대통령선거 14~18대 파서
//
// 14대(1992): 시도명/구시군명/읍면동명 행, row0=헤더, row1=후보구분, row2=정당명, row3=후보명, row4+=데이터
//   col: 시도명(0), 구시군명(1), 읍면동명(2), 선거인수(3), 부재자수(4), 투표수(5), 부재자투표수(6), 유효투표수(7), parties(8..N-2), 계(N-1), 무효(N-2...), 기권수(last)
//   식별: row[2]="소계" → 시군구 합계, row[2]=읍면동명 → 읍면동 행
//
// 15대(1997): 동일 구조 (col 차이 없음)
//
// 16대(2002): 단일 시트 per-투표구
//   col: 위원회명(0), 읍면동명(1), 투표구명(2), 선거인수(3), 투표수(4), parties(5..N-3), 유효투표수(N-2), 무효투표수(N-1), 기권수(last)
//   row0=헤더, row1=[종로구] 합계, ...
//   식별: row[2]=""&row[1]="합계" → 선거구 합계, row[2]="소계" → 읍면동 합계
//
// 17대(2007): per-sido xls (zip 내), per-sigungu 시트
//   col: 구시군명(0), 읍면동명(1), 투표구명(2), 선거인수(3), 투표용지교부수(4), 투표수(5), parties(6..N-2), 계(N-1), 무효(N-1), 기권수(last)
//   row0=헤더, row1=정당명, row2=후보명, row3+=데이터
//   식별: row[2]="" & row[1]="합계" → sigungu total
//          row[2]="" & row[1]="부재자" → absentee
//          row[2]="소계" → emd subtotal
//
// 18대(2012): 이미 있음 → skip

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

function extractPartyName(raw: string | null | undefined): string {
  if (!raw) return "";
  // Remove candidate name after newline or space patterns
  const s = String(raw).trim();
  // 파티이름\n후보명 형태
  const lines = s.split(/\r?\n/);
  return lines[0].trim();
}

// ── 14대/15대 대통령 파서 ──────────────────────────────────────────────────
// col: 시도명(0), 구시군명(1), 읍면동명(2), 선거인수(3), 부재자수(4), 투표수(5), 부재자투표수(6), 유효투표수(7), parties(8...), 계, 무효투표수, 기권수
function parsePresidential1415(
  sheet: XLSX.WorkSheet,
  electionId: string,
  electionDate: string
): ParsedElection {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 5) return { electionId, electionDate, rows: [], partyNames: [] };

  // Find party columns from row2 (party names)
  // 14대: 시도명(0),구시군명(1),읍면동명(2),선거인수(3),부재자수(4),투표자수(5),부재자투표자수(6),유효투표수(7→첫 정당),parties(7..N-3),계,무효,기권
  // 실제: 민자당=col7, 민주당=col8, ... 무소속=col14, 계=col15
  // 15대: 한나라당=col7, 국민회의=col8, ...
  const partyRow = json[2] as (string | null)[];
  // parties start at col 7 (유효투표수 열이 col7이지만 실제론 첫 정당명이 col7에)
  let startCol = 7;
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 7; i--) {
    const v = partyRow[i];
    if (v && String(v).trim() === "계") { endCol = i; break; }
    if (v && (String(v).includes("무효") || String(v).includes("기권"))) { endCol = i; break; }
  }
  // if endCol == partyRow.length-1 (no "계" found), use last few cols as non-party
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = startCol; i <= endCol; i++) {
    const n = partyRow[i];
    if (!n || typeof n !== "string") continue;
    const cleaned = n.trim().replace(/\s+/g, "");
    if (!cleaned) continue;
    partyCols.push({ idx: i, name: n.trim().replace(/\s+/g, "") });
  }

  if (partyCols.length === 0) return { electionId, electionDate, rows: [], partyNames: [] };

  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (let r = 4; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const sido = String(row[0] ?? "").trim();
    const sigungu = String(row[1] ?? "").trim();
    const emd = String(row[2] ?? "").trim();

    if (!sido && !sigungu && !emd) continue;
    if (sido === "전국" && sigungu === "합계") continue; // nationwide total
    if (emd === "") continue; // skip row without emd info
    if (sido === "시도명" || sigungu === "구시군명") continue; // header rows

    const voters = toNum(row[3]);
    const votes = toNum(row[5]); // 투표자수
    // 계 열 = endCol+1 (parties sum), 무효 = votes - 계
    const sumCol = endCol + 1;
    const sumVotes = toNum(row[sumCol]);
    const validVotes = sumVotes > 0 ? sumVotes : partyCols.reduce((a, pc) => a + toNum(row[pc.idx]), 0);

    const parties = partyCols
      .map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const totalPartyVotes = parties.reduce((a, b) => a + b.votes, 0);

    if (totalPartyVotes === 0) continue;

    parties.forEach(p => partySet.add(p.rawName));

    const emdOrKind = emd;
    let emdName: string | null = null;
    let kind: ParsedStationRow["kind"] = "subtotal";

    if (emdOrKind === "소계") {
      // 시군구 합계 또는 시도 합계
      if (sigungu === "합계") continue; // 시도 합계 skip
      emdName = null;
      kind = "total";
    } else {
      // 읍면동 행
      emdName = emdOrKind;
      kind = "subtotal";
    }

    allRows.push({
      sidoName: sido,
      sigunguName: sigungu,
      emdName,
      stationName: null,
      kind,
      totalVoters: voters,
      totalVotes: votes,
      validVotes,
      invalidVotes: Math.max(0, votes - validVotes),
      parties,
    });
  }

  return { electionId, electionDate, rows: allRows, partyNames: [...partySet] };
}

// ── 16대 대통령 파서 ──────────────────────────────────────────────────────
// 구조: 위원회명(0), 읍면동명(1), 투표구명(2), 선거인수(3), 투표수(4), parties(5...), 유효(N-2), 무효(N-1), 기권(last)
// 헤더 row0에 "위원회명" 등이 있음
// row1부터 데이터: [종로구] | 합계 | (blank) | ...
// 위원회명에 "[구청]" 형태로 구시군 이름이 있음
function parsePresidential16(sheet: XLSX.WorkSheet): ParsedElection {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 2) return { electionId: "2002-presidential", electionDate: "2002-12-19", rows: [], partyNames: [] };

  // row0: 헤더 — parties start at col5
  const headerRow = json[0] as (string | null)[];
  let endCol = headerRow.length - 1;
  // find "유효투표수" to determine end of party cols
  for (let i = headerRow.length - 1; i >= 5; i--) {
    const v = headerRow[i];
    if (v && (String(v).includes("유효") || String(v).includes("무효"))) { endCol = i; break; }
  }
  // Also check for "계" label which may be at endCol
  // actually check: 이회창 노무현 이한동 권영길 김영규 김길수 유효투표수 무표 기권
  // col5=이회창...col10=유효, col11=무표, col12=기권
  // parties are at fixed cols: 5,6,7,8,9,10 (들쭉날쭉 없음 — fixed 6 candidates)

  // row0에 이미 후보명이 있음: 이회창, 노무현, 이한동, 권영길, 김영규, 김길수
  // 정당명으로 변환 (16대 대선 고정 후보 매핑)
  const candidate16ToParty: Record<string, string> = {
    "이회창": "한나라당",
    "노무현": "새천년민주당",
    "이한동": "하나로국민연합",
    "권영길": "민주노동당",
    "김영규": "사회당",
    "김길수": "민주공화당",
  };

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 5; i < headerRow.length - 2; i++) {
    const n = headerRow[i];
    if (!n) continue;
    const cleaned = String(n).trim();
    if (!cleaned) continue;
    if (cleaned === "유효투표수" || cleaned === "무표투표수" || cleaned === "기권수") break;
    // 후보명 → 정당명 변환
    const partyName = candidate16ToParty[cleaned] || cleaned;
    partyCols.push({ idx: i, name: partyName });
  }

  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  // Track current sigungu from "[XXX]" markers
  let currentSigungu = "";
  let currentEmd = "";
  let currentSido = "";

  // Second sheet has per-sigungu absentee rows
  // First sheet has투표구별 rows — we extract 합계(sigungu) and 소계(emd) rows

  for (let r = 1; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const col0 = String(row[0] ?? "").trim();
    const col1 = String(row[1] ?? "").trim();
    const col2 = String(row[2] ?? "").trim();

    // "[구청]" 형태 위원회 식별 — col0은 모든 행에 반복됨
    if (col0.startsWith("[") && col0.endsWith("]")) {
      currentSigungu = col0.slice(1, -1);
      // sido는 추론 불가 → 공백 유지
    }

    // col0이 순수 텍스트 "[...]" 아닌 경우도 위원회명이 반복됨
    // 데이터가 있는 행인지 확인
    const voters = toNum(row[3]);
    const votes = toNum(row[4]);

    // 시군구 합계 행: col1="합계", col2=""
    if (col1 === "합계" && col2 === "") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      parties.forEach(p => partySet.add(p.rawName));
      allRows.push({
        sidoName: "",
        sigunguName: currentSigungu,
        emdName: null,
        stationName: null,
        kind: "total",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // 부재자 행: col1="부재자"
    if (col1 === "부재자" && col2 === "") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      parties.forEach(p => partySet.add(p.rawName));
      allRows.push({
        sidoName: "",
        sigunguName: currentSigungu,
        emdName: null,
        stationName: null,
        kind: "absentee",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // 읍면동 소계 행: col1=읍면동명, col2="소계"
    if (col1 && col2 === "소계") {
      const emd = col1;
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      parties.forEach(p => partySet.add(p.rawName));
      allRows.push({
        sidoName: "",
        sigunguName: currentSigungu,
        emdName: emd,
        stationName: null,
        kind: "subtotal",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }
  }

  return { electionId: "2002-presidential", electionDate: "2002-12-19", rows: allRows, partyNames: [...partySet] };
}

// ── 17대 대통령 파서 ──────────────────────────────────────────────────────
// per-sido xls (zip 내), per-sigungu 시트(시도 이름)
// col: 구시군명(0), 읍면동명(1), 투표구명(2), 선거인수(3), 투표용지교부수(4), 투표수(5), parties(6..N-2), 계(N-1), 무효, 기권
function parsePresidential17Sheet(
  sheet: XLSX.WorkSheet,
  sidoName: string
): ParsedStationRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // row1: party names at col6+
  const partyRow = json[1] as (string | null)[];
  let endCol = partyRow.length;
  for (let i = partyRow.length - 1; i >= 6; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 6; i < endCol; i++) {
    const n = partyRow[i];
    if (!n || typeof n !== "string") continue;
    const cleaned = n.trim().replace(/\s+/g, "");
    if (!cleaned || cleaned === "계") continue;
    partyCols.push({ idx: i, name: n.trim() });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];

  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const sigungu = String(row[0] ?? "").trim();
    const emd = String(row[1] ?? "").trim();
    const station = String(row[2] ?? "").trim();

    if (!sigungu && !emd && !station) continue;

    const voters = toNum(row[3]);
    const votes = toNum(row[5]);

    // 합계 행: emd="합계", station=""
    if (emd === "합계" && station === "") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName: sigungu, emdName: null, stationName: null,
        kind: "total",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // 부재자 행: emd="부재자"
    if (emd === "부재자") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName: sigungu, emdName: null, stationName: null,
        kind: "absentee",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // 소계 행: station="소계"
    if (station === "소계") {
      const emdName = emd || null;
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName: sigungu, emdName, stationName: null,
        kind: "subtotal",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }
  }

  return result;
}

// 시도명 from filename
function getPresidential17Sido(filename: string): string {
  const map: Record<string, string> = {
    서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시",
    인천: "인천광역시", 광주: "광주광역시", 대전: "대전광역시",
    울산: "울산광역시", 경기: "경기도", 강원: "강원도",
    충북: "충청북도", 충남: "충청남도", 전북: "전라북도",
    전남: "전라남도", 경북: "경상북도", 경남: "경상남도",
    제주: "제주특별자치도",
  };
  for (const [k, v] of Object.entries(map)) {
    if (filename.includes(k)) return v;
  }
  return filename;
}

// ── Main export functions ───────────────────────────────────────────────

export function parse1992Presidential(zipPath: string): ParsedElection {
  const zip = new AdmZip(zipPath);
  const xls14 = zip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("14대") && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });
  if (!xls14) throw new Error("14대 xls not found");
  const wb = XLSX.read(xls14.getData(), { type: "buffer" });
  return parsePresidential1415(wb.Sheets[wb.SheetNames[0]], "1992-presidential", "1992-12-18");
}

export function parse1997Presidential(zipPath: string): ParsedElection {
  const zip = new AdmZip(zipPath);
  const xls15 = zip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("15대") && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });
  if (!xls15) throw new Error("15대 xls not found");
  const wb = XLSX.read(xls15.getData(), { type: "buffer" });
  return parsePresidential1415(wb.Sheets[wb.SheetNames[0]], "1997-presidential", "1997-12-18");
}

export function parse2002Presidential(zipPath: string): ParsedElection {
  const zip = new AdmZip(zipPath);
  const xls16 = zip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("16대") && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });
  if (!xls16) throw new Error("16대 xls not found");
  const wb = XLSX.read(xls16.getData(), { type: "buffer" });
  return parsePresidential16(wb.Sheets[wb.SheetNames[0]]);
}

export function parse2007Presidential(zipPath: string): ParsedElection {
  const zip = new AdmZip(zipPath);
  const zip17 = zip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("17대") && n.endsWith(".zip");
  });
  if (!zip17) throw new Error("17대 zip not found");

  const innerZip = new AdmZip(zip17.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of innerZip.getEntries()) {
    const n = dec(Buffer.from(entry.rawEntryName));
    if (!n.endsWith(".xls") && !n.endsWith(".xlsx")) continue;
    if (entry.isDirectory) continue;

    const sidoName = getPresidential17Sido(n);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const rows = parsePresidential17Sheet(wb.Sheets[sheetName], sidoName);
      rows.forEach(r => r.parties.forEach(p => partySet.add(p.rawName)));
      allRows.push(...rows);
    }
  }

  return { electionId: "2007-presidential", electionDate: "2007-12-19", rows: allRows, partyNames: [...partySet] };
}

// ── Main ───────────────────────────────────────────────────────────────────
if (require.main === module) {
  const zipPath = "/Users/ahbaik/Downloads/대통령선거 개표결과(제14대~제18대).zip";
  const outDir = "data/parsed";
  mkdirSync(outDir, { recursive: true });

  console.log("▶ 1992-presidential...");
  const p1992 = parse1992Presidential(zipPath);
  console.log(`  rows=${p1992.rows.length}  parties=${p1992.partyNames.length}`);
  console.log("  정당:", p1992.partyNames.join(", "));
  writeFileSync(path.join(outDir, "1992-presidential.json"), JSON.stringify(p1992));

  console.log("▶ 1997-presidential...");
  const p1997 = parse1997Presidential(zipPath);
  console.log(`  rows=${p1997.rows.length}  parties=${p1997.partyNames.length}`);
  console.log("  정당:", p1997.partyNames.join(", "));
  writeFileSync(path.join(outDir, "1997-presidential.json"), JSON.stringify(p1997));

  console.log("▶ 2002-presidential...");
  const p2002 = parse2002Presidential(zipPath);
  console.log(`  rows=${p2002.rows.length}  parties=${p2002.partyNames.length}`);
  console.log("  정당:", p2002.partyNames.join(", "));
  writeFileSync(path.join(outDir, "2002-presidential.json"), JSON.stringify(p2002));

  console.log("▶ 2007-presidential...");
  const p2007 = parse2007Presidential(zipPath);
  console.log(`  rows=${p2007.rows.length}  parties=${p2007.partyNames.length}`);
  console.log("  정당:", p2007.partyNames.join(", "));
  writeFileSync(path.join(outDir, "2007-presidential.json"), JSON.stringify(p2007));

  console.log("Done.");
}
