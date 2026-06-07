// scripts/build/parsers/parse-jiseon-3-6.ts
// 3~6회 지선 파서 (2002/2006/2010/2014)
//
// 각 회차별 구조가 매우 다름:
//
// === 3회 (2002-06-13) ===
// 비례대표만 (시도의원비례) — per-sido xls, sheet="col 1"
// 시도지사 zip은 CP949 인코딩 불량(per-sigungu xls) — skip (emd 없음)
//
// 비례 구조: 위원회명(0), 투표구명(1), 선거인수(2), 투표수(3), parties(4..N-2), 계(N-1), 투표율(%), 유효투표율(%)
// 투표구명 = "합계" → 시군구 합계, "부재자" → absentee, 읍면동명 → emd
//
// === 4회 (2006-05-31) ===
// per-sigungu xls (CP949 이슈 없음)
// 시도지사: 읍면동명(0), 선거인수(1), _, 투표수(3), parties(4..N-2), 계(N-1), 무효, 기권
//           row0=선거구이름, row1=blank, row2=헤더, row3=정당명, row4=blank(data시작별 없음), row5+=데이터
// 비례대표시도의원: 읍면동명(0), 선거인수(1), _, 투표수(3), parties(4..N-2), 계(N-1), 무효, 기권
//                  헤더 row 3개 후 데이터
//
// === 5회 (2010-06-02) ===
// per-sido xls, sheet=시도명
// 구조: 구시군명(0), 읍면동명(1), 선거인수(2), 투표수(3), parties(4..N-2), 계(N-1), 무효, 기권
// row0=title, row1=blank, row2=[시도지사선거], row3=[구시군명, 읍면동명, ...], row4=정당명, (row5=공백 or data)
//
// === 6회 (2014-06-04) ===
// per-sido zip (경남, 경기, etc.), per-election folder, per-sigungu xls OR per-sido xls
// 구시군(0), 읍면동명(1), 구분(2), 선거인수(3), 투표수(4), parties(5..N-2), 계(N-1), 무효, 기권
// row0=blank, row1=헤더
//
// 비례 (광역의원비례/기초의원비례):
// 구시군(0), 읍면동명(1), 구분(2), 선거인수(3), 투표수(4), parties(5..N-2), 계(N-1), 무효, 기권
// 구분: "합계" = 시군구 합계, "관외사전투표" = abs, 읍면동명 = subtotal

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
  // "581,175\n(55.95)" → "581175" (콤마 제거, 줄바꿈+괄호 제거)
  const s = String(v ?? "").replace(/,/g, "").split(/[\n\r]/)[0].trim().replace(/\([^)]*\)$/, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const SKIP_PARTY_NAMES = new Set([
  "정당별 득표수", "후보자별 득표수", "계", "합계", "기권수", "무효투표수", "무효\n투표수",
  "유 효 투 표 수 (가)", "정 당 별 득 표 수", "후 보 자 별 득 표 수",
]);

function extractPartyName(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim().split(/\r?\n/)[0].trim().replace(/\s+/g, " ");
  if (SKIP_PARTY_NAMES.has(s)) return "";
  if (SKIP_PARTY_NAMES.has(s.replace(/\s+/g, ""))) return "";
  return s;
}

// ── 3회 지선 시도지사/시군장 파서 (CP949 BIFF5 구조) ────────────────────────
// 구조: 위원회명(0), 투표구명(1), 선거인수(2), 투표수(3), parties(4..N-3), 계(N-2), 투표율, 유효율
// 3회 시도지사·시군장 xls는 BIFF5 포맷이라 SheetJS가 내부 문자열을 EUC-KR로 읽지 못함.
// codepage: 949 옵션을 명시적으로 넘겨서 해결.
function parse3HoeGovXls(xls: Buffer, sidoName: string): ParsedStationRow[] {
  // codepage 949 강제 지정으로 BIFF5 내 한글 복원
  const wb = XLSX.read(xls, { type: "buffer", codepage: 949 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // 헤더 행 탐색 (row 0~2 중 party col 있는 행)
  // 정당명 조건: 2자 이상, 키워드 없음(공백 제거 후 확인), 대괄호 시작 아님
  let partyRowIdx = -1;
  for (let i = 0; i < Math.min(json.length, 5); i++) {
    const row = json[i] as (string | null)[];
    const count = row.slice(3).filter(v => {
      if (!v) return false;
      const raw = String(v).trim();
      if (raw.startsWith("[")) return false;
      const s = raw.replace(/\s+/g, "");
      return s.length >= 2 && s !== "계" &&
        !s.includes("득표") && !s.includes("투표") &&
        !s.includes("선거") && !s.includes("무효") &&
        !s.includes("기권") && !s.includes("유효") &&
        !s.includes("투표율") && !s.includes("(%)");
    }).length;
    if (count >= 2) { partyRowIdx = i; break; }
  }
  if (partyRowIdx < 0) return [];

  const partyRow = json[partyRowIdx] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 3; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 3; i < endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name) continue;
    partyCols.push({ idx: i, name });
  }
  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  let currentSigungu = "";

  for (let r = partyRowIdx + 1; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const wiwon = String(row[0] ?? "").trim();
    const station = String(row[1] ?? "").trim();
    if (!wiwon && !station) continue;
    if (wiwon) currentSigungu = wiwon;

    const voters = toNum(row[2]);
    const votes = toNum(row[3]);
    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = null;

    if (!station || station === "합계") {
      kind = "total";
    } else if (station === "부재자" || station === "잘못투입된투표지") {
      kind = "absentee";
    } else {
      emdName = station;
      kind = "subtotal";
    }

    result.push({
      sidoName,
      sigunguName: currentSigungu,
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
  return result;
}

// ── 3회 시군장 파서 ─────────────────────────────────────────────────────────
// 구조: 위원회명(0)=없음, 투표구명(0), 선거인수(1), 투표수(2), parties(3..N-2), 계(N-1), 투표율, 유효율
// 시군구당 1개 파일, sidoName 없이 sigunguName만 있음 (파일명에서 추출)
function parse3HoeMayorXls(xls: Buffer, sigunguName: string): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer", codepage: 949 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // 헤더 탐색 — col3+ 에 정당명 있는 첫 행
  // 정당명 조건: 2자 이상, 키워드 없음(공백제거 후 확인), 대괄호([]) 시작 아님
  let partyRowIdx = -1;
  for (let i = 0; i < Math.min(json.length, 6); i++) {
    const row = json[i] as (string | null)[];
    const count = row.slice(3).filter(v => {
      if (!v) return false;
      const raw = String(v).trim();
      if (raw.startsWith("[")) return false;  // [가평군] 등 지역명 제외
      const s = raw.replace(/\s+/g, "");  // 공백 제거 후 키워드 확인
      return s.length >= 2 && s !== "계" &&
        !s.includes("득표") && !s.includes("투표") &&
        !s.includes("선거") && !s.includes("무효") &&
        !s.includes("기권") && !s.includes("유효") &&
        !s.includes("투표율") && !s.includes("비율") &&
        !s.includes("(%)");
    }).length;
    if (count >= 1) { partyRowIdx = i; break; }
  }
  if (partyRowIdx < 0) return [];

  const partyRow = json[partyRowIdx] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 3; i--) {
    const v = partyRow[i];
    if (v && String(v).trim() === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 3; i < endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name) continue;
    partyCols.push({ idx: i, name });
  }
  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];

  for (let r = partyRowIdx + 1; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const station = String(row[0] ?? "").trim();
    if (!station) continue;

    const voters = toNum(row[1]);
    const votes = toNum(row[2]);
    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = null;

    if (station === "합계") {
      kind = "total";
    } else if (station === "부재자" || station === "잘못투입된투표지") {
      kind = "absentee";
    } else if (station === "소계") {
      kind = "subtotal";
    } else {
      emdName = station;
      kind = "subtotal";
    }

    result.push({
      sidoName: "",  // 3회 시군장은 시도명 파일명에 없음 — build-static에서 region lookup
      sigunguName,
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
  return result;
}

// ── 3회 지선 비례대표 파서 ──────────────────────────────────────────────────
// sheet: "col 1", 위원회명(0), 투표구명(1), 선거인수(2), 투표수(3), parties(4..N-3), 계(N-2), 투표율, 유효율
function parse3HoeBipyeo(xls: Buffer, sidoName: string): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // row2: 정당명 (col4+)
  const partyRow = json[2] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 4; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 4; i < endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name) continue;
    partyCols.push({ idx: i, name });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  let currentSigungu = "";

  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const wiwon = String(row[0] ?? "").trim();
    const station = String(row[1] ?? "").trim();

    if (!wiwon && !station) continue;

    // 위원회명(시군구) 업데이트
    if (wiwon) currentSigungu = wiwon;

    const voters = toNum(row[2]);
    const votes = toNum(row[3]);

    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = null;

    if (station === "합계" || station === "") {
      kind = "total";
    } else if (station === "부재자") {
      kind = "absentee";
    } else {
      emdName = station;
      kind = "subtotal";
    }

    result.push({
      sidoName,
      sigunguName: currentSigungu,
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

  return result;
}

// ── 4회 지선 파서 ────────────────────────────────────────────────────────────
// 비례대표시도의원 per-sigungu xls
// row0=[선거구이름], row1=blank, row2=헤더, row3=정당명, row4=blank, row5+=데이터
// 실제로는 row2=[읍면동명, 선거인수, _, 투표수, parties..., 계, 무효, 기권]
//           row3=[_, _, _, _, 정당명들, _, _, _]
// 4회 시도지사 per-sigungu xls도 비슷한 구조지만 후보명+정당명 혼합 있음
function parse4HoeXls(
  xls: Buffer,
  sidoName: string,
  sigunguName: string  // 파일명에서 추출
): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 5) return [];

  // Find party header row (first row with 3+ party-like entries)
  let partyRowIdx = -1;
  for (let i = 0; i < Math.min(json.length, 8); i++) {
    const row = json[i] as (string | null)[];
    // 정당 행은 빈 셀이 많고 col4+ 에 정당명이 있음
    const partyCount = row.slice(4).filter(v => {
      if (!v) return false;
      const s = String(v).trim();
      if (s.length === 0 || s.startsWith("[")) return false;
      if (s === "계" || s.includes("득표") || s.includes("투표") || s.includes("선거") || s.includes("기권")) return false;
      return true;
    }).length;
    if (partyCount >= 2) {
      partyRowIdx = i;
      break;
    }
  }

  if (partyRowIdx < 0) return [];

  const partyRow = json[partyRowIdx] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 4; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 4; i < endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name || name === "계") continue;
    partyCols.push({ idx: i, name });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  const dataStartRow = partyRowIdx + 1;

  for (let r = dataStartRow; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const emd = String(row[0] ?? "").trim();
    if (!emd) continue;
    if (emd === "읍면동명") continue; // 헤더 재출현 skip

    const voters = toNum(row[1]);
    const votes = toNum(row[3]);

    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = emd;

    if (emd === "합계") {
      kind = "total";
      emdName = null;
    } else if (emd === "관외사전투표" || emd === "거소투표") {
      kind = "abs";
    } else {
      kind = "subtotal";
    }

    result.push({
      sidoName,
      sigunguName,
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

  return result;
}

// 4회 파일명에서 시군구명 추출: "4801_창원시_경상남도.xls" → "창원시"
function extract4HoeSimguname(filename: string): string {
  const m = filename.match(/\d{4}_([^_]+)_/);
  return m ? m[1] : filename;
}

// 4회 파일경로에서 시도명 추출
function extract4HoeSidoname(filepath: string): string {
  // e.g. "제4회.../1_시도지사/48_경남/4801_창원시_경상남도.xls"
  // or from 경상남도
  const map: Record<string, string> = {
    "11_서울": "서울특별시", "26_부산": "부산광역시", "27_대구": "대구광역시",
    "28_인천": "인천광역시", "29_광주": "광주광역시", "30_대전": "대전광역시",
    "31_울산": "울산광역시", "41_경기": "경기도", "42_강원": "강원도",
    "43_충북": "충청북도", "44_충남": "충청남도", "45_전북": "전라북도",
    "46_전남": "전라남도", "47_경북": "경상북도", "48_경남": "경상남도",
    "50_제주": "제주특별자치도",
  };
  for (const [k, v] of Object.entries(map)) {
    if (filepath.includes(k)) return v;
  }
  // fallback from filename
  const suf = filepath.split("_").pop()?.replace(".xls", "") ?? "";
  return suf.includes("경상남도") ? "경상남도" : suf;
}

// ── 5회 지선 파서 ────────────────────────────────────────────────────────────
// per-sido xls, sheet=시도명
// row0=title, row1=blank, row2=[시도지사선거 등], row3=[구시군명,읍면동명,선거인수,투표수,parties...,계,무효,기권]
// row4=정당명 (parties start at col4)
// row5+(data)
function parse5HoeXls(xls: Buffer, sidoName: string): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 6) return [];

  // Find party row (row with 정당명 at col4+)
  // Note: 5회 시도지사 has row3=[..., "후보자별 득표수"...] and row4=[..., "한나라당\n오세훈"...]
  let partyRowIdx = 4; // default
  for (let i = 2; i < Math.min(json.length, 8); i++) {
    const row = json[i] as (string | null)[];
    const hasParty = row.slice(4).some(v => {
      if (!v) return false;
      const s = String(v).trim();
      if (s.length <= 1) return false;
      if (s.startsWith("[")) return false;
      // 헤더 항목들 제외
      if (s === "후보자별 득표수" || s === "정당별 득표수") return false;
      if (s.includes("무효") || s.includes("기권") || s.includes("구시군") || s.includes("읍면동") || s.includes("선거인")) return false;
      return true;
    });
    if (hasParty) { partyRowIdx = i; break; }
  }

  const partyRow = json[partyRowIdx] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 4; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 4; i < endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name || name === "계" || name === "무효투표수" || name === "기권수") continue;
    partyCols.push({ idx: i, name });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  let currentSigungu = "";

  for (let r = partyRowIdx + 1; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const sigungu = String(row[0] ?? "").trim();
    const emd = String(row[1] ?? "").trim();

    if (!sigungu && !emd) continue;
    if (sigungu === "구시군명") continue; // 헤더 재출현

    // 시군구명 갱신
    if (sigungu && sigungu !== "합계") currentSigungu = sigungu;

    const voters = toNum(row[2]);
    const votes = toNum(row[3]);

    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = emd || null;

    if (!emd || emd === "합계") {
      kind = "total";
      emdName = null;
    } else if (emd === "거소투표" || emd === "관외사전투표") {
      kind = "abs";
    } else {
      kind = "subtotal";
    }

    result.push({
      sidoName,
      sigunguName: currentSigungu || sigungu,
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

  return result;
}

// ── 6회 지선 파서 ────────────────────────────────────────────────────────────
// 6회: per-sido zip 내 per-election folder, per-sigungu OR per-sido xls
// 구조: 구시군(0), 읍면동명(1), 구분(2), 선거인수(3), 투표수(4), parties(5...), 계, 무효, 기권
// row0=blank, row1=헤더
// 비례: 구시군(0), 읍면동명(1), 구분(2), 선거인수(3), 투표수(4), parties(5...), 계(N), 무효(N+1), 기권(N+2)
// 시도지사: per-sido xls, 구조: 구시군(0), 읍면동명(1), 구분(2), 선거인수(3), 투표수(4), parties(5...), 계, 무효, 기권

function parse6HoeXls(xls: Buffer, sidoName: string, sigunguOverride?: string): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 3) return [];

  // Detect layout: per-sido vs per-sigungu
  // Per-sido: col0=구시군, col1=읍면동, col2=구분, col3=선거인수, col4=투표수, col5+=parties
  // Per-sigungu: col0=읍면동, col1=구분, col2=선거인수, col3=투표수, col4+=parties
  //
  // We detect by finding the party row and checking if col0 has 구시군명 header
  let perSido = false;
  let headerRowIdx = -1;
  // 대구/부산 등 "시도명" 헤더 (col0="대구광역시") → per-sido 2열 형식 (sigungu | gubun | 선거인수 | 투표수 | parties)
  let perSidoSimple = false;  // col0=시군구, col1=null, col2=선거인수, col3=투표수, col4+=parties

  for (let i = 0; i < Math.min(json.length, 5); i++) {
    const row = json[i] as (string | null)[];
    const col0 = String(row[0] ?? "").trim();
    const col0norm = col0.replace(/\s+/g, "");
    if (col0norm === "구시군" || col0norm === "구시군명" || col0norm === "구시군별" ||
        col0norm === "위원회명") {  // 경기/충남 등 "위원회명" 헤더도 per-sido 형식
      perSido = true;
      headerRowIdx = i;
      break;
    }
    if (col0norm === "읍면동명" || col0norm === "읍면동") {
      perSido = false;
      headerRowIdx = i;
      break;
    }
    // 대구광역시 같이 시도명이 헤더인 경우 → per-sido simple
    if (col0.endsWith("광역시") || col0.endsWith("특별시") || col0.endsWith("도") ||
        col0.endsWith("특별자치시") || col0.endsWith("특별자치도")) {
      // 다음 줄이 실제 헤더 아닌 경우 (col0에 시군구명이 오는 패턴)
      perSido = true;
      perSidoSimple = true;
      headerRowIdx = i;
      break;
    }
  }

  // party row = headerRowIdx + 1 (정당명 행), but may need +2 if extra group header exists
  let partyRowIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 2;
  // Check if the next row is an intermediate group header (has "득표" label, possibly with spaces)
  if (partyRowIdx < json.length) {
    const candidate = json[partyRowIdx] as (string | null)[];
    const isGroupHeader = candidate.some(v => {
      if (!v) return false;
      const s = String(v).replace(/\s+/g, "");
      return (s.includes("득표수") || s.includes("후보자별") || s.includes("정당별")) && !String(v).includes("\n");
    });
    if (isGroupHeader) partyRowIdx++;
  }

  const partyRow = json[partyRowIdx] as (string | null)[];
  // perSidoSimple(대구 등 시도명 헤더): col0=시군구, col1=구분, col2=선거인수, col3=투표수, col4+=parties
  // perSido: col0=구시군, col1=읍면동, col2=구분, col3=선거인수, col4=투표수, col5+=parties
  // perSigungu: col0=읍면동, col1=구분, col2=선거인수, col3=투표수, col4+=parties
  const partyStartCol = (perSido && !perSidoSimple) ? 5 : 4;

  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= partyStartCol; i--) {
    const v = partyRow[i];
    if (v && String(v).trim() === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) {
    // Try to find last actual party col before "무효" or "기권"
    for (let i = partyRow.length - 1; i >= partyStartCol; i--) {
      const v = partyRow[i];
      if (!v) continue;
      const s = String(v).trim();
      if (s.includes("무효") || s.includes("기권") || s === "계") continue;
      endCol = i;
      break;
    }
  }

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = partyStartCol; i <= endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name || name === "계" || name === "무효투표수" || name === "기권수") continue;
    partyCols.push({ idx: i, name });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  const dataStart = partyRowIdx + 1;
  let currentSigungu = sigunguOverride ?? "";

  for (let r = dataStart; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    let sigungu = "", emd = "", gubun = "", voters = 0, votes = 0;

    if (perSidoSimple) {
      // 대구/부산 등 시도명 헤더: col0=시군구, col1=구분(보통 null), col2=선거인수, col3=투표수, col4+=parties
      sigungu = String(row[0] ?? "").trim();
      gubun = String(row[1] ?? "").trim();
      voters = toNum(row[2]);
      votes = toNum(row[3]);
    } else if (perSido) {
      sigungu = String(row[0] ?? "").trim();
      emd = String(row[1] ?? "").trim();
      gubun = String(row[2] ?? "").trim();
      voters = toNum(row[3]);
      votes = toNum(row[4]);
    } else {
      // per-sigungu: col0=읍면동명, col1=구분, col2=선거인수, col3=투표수
      emd = String(row[0] ?? "").trim();
      gubun = String(row[1] ?? "").trim();
      voters = toNum(row[2]);
      votes = toNum(row[3]);
      sigungu = currentSigungu;
    }

    if (!sigungu && !emd) continue;
    // 섹션 구분자 행 (e.g. "[시·도지사선거][대구광역시][중구]") 건너뜀
    if (sigungu.startsWith("[") || emd.startsWith("[")) continue;
    // perSidoSimple에서 새 헤더 행 감지 시 종료 (대구 emd 세부 섹션 방지)
    if (perSidoSimple && (sigungu === "읍면동명" || emd === "읍면동명")) break;
    const sigunguNorm = sigungu.replace(/\s+/g, "");
    if ((perSido || perSidoSimple) && sigungu && sigunguNorm !== "합계") currentSigungu = sigungu;
    else if (!perSido && !perSidoSimple && sigunguOverride) currentSigungu = sigunguOverride;

    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = emd || null;

    // 공백 정규화 후 비교 ("합       계" → "합계")
    const gubunNorm = gubun.replace(/\s+/g, "");
    const emdNorm = emd.replace(/\s+/g, "");
    const sigunguNorm2 = sigungu.replace(/\s+/g, "");

    if (perSidoSimple) {
      // 대구/부산 등: col0=시군구, 합계 행은 시군구 총계
      if (sigunguNorm2 === "합계") {
        // 시도 전체 합계 행 — skip (시군구 단위 없음)
        continue;
      }
      kind = "total";
      emdName = null;
      // currentSigungu is already set above
    } else if (gubunNorm === "합계" || gubunNorm === "" || emdNorm === "합계") {
      if (!emd || emdNorm === "합계") {
        kind = "total";
        emdName = null;
      } else {
        kind = "subtotal";
      }
    } else if (gubunNorm === "관외사전투표" || gubunNorm === "거소투표" ||
               emdNorm === "관외사전투표" || emdNorm === "거소우편투표") {
      kind = "abs";
      emdName = emd || null;
    } else {
      emdName = emd || gubun;
      kind = "subtotal";
    }

    result.push({
      sidoName,
      sigunguName: currentSigungu || sigungu,
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

  return result;
}

// ── 시도명 매핑 ─────────────────────────────────────────────────────────────
const SIDO_MAP_3HOE: Record<string, string> = {
  강원: "강원도", 경기: "경기도", 경남: "경상남도", 경북: "경상북도",
  광주: "광주광역시", 대구: "대구광역시", 대전: "대전광역시", 부산: "부산광역시",
  서울: "서울특별시", 울산: "울산광역시", 인천: "인천광역시", 전남: "전라남도",
  전북: "전라북도", 제주: "제주특별자치도", 충남: "충청남도", 충북: "충청북도",
};

function getSido3Hoe(filename: string): string {
  const base = filename.replace(".xls", "").replace(".xlsx", "");
  return SIDO_MAP_3HOE[base] ?? base;
}

const SIDO_MAP_5HOE: Record<string, string> = {
  "01_서울특별시": "서울특별시",
  "02_부산광역시": "부산광역시",
  "03_대구광역시": "대구광역시",
  "04_인천광역시": "인천광역시",
  "05_광주광역시": "광주광역시",
  "06_대전광역시": "대전광역시",
  "07_울산광역시": "울산광역시",
  "08_경기도": "경기도",
  "09_강원도": "강원도",
  "10_충청북도": "충청북도",
  "11_충청남도": "충청남도",
  "12_전라북도": "전라북도",
  "13_전라남도": "전라남도",
  "14_경상북도": "경상북도",
  "15_경상남도": "경상남도",
  "16_제주특별자치도": "제주특별자치도",
};

function getSido5Hoe(filename: string): string {
  const base = filename.replace(".xls", "").replace(".xlsx", "");
  for (const [k, v] of Object.entries(SIDO_MAP_5HOE)) {
    if (base.includes(k.split("_")[0]) && base.includes(k.split("_")[1])) return v;
    if (filename.includes(k)) return v;
  }
  return base;
}

// 5회 비례 파일명: "15_경상남도.xls" → "경상남도"
function getSido5HoeFromFilename(filename: string): string {
  const m = filename.match(/\d+_(.+?)\.xls/);
  if (m) return m[1];
  return getSido5Hoe(filename);
}

// 5회 비례 전용 파서 — row3=헤더, row4=정당명, row5=blank, row6+=데이터
// 시도지사 구조와 다름: col0=구시군명, col1=읍면동명, col2=선거인수, col3=투표수, col4+= parties
function parse5HoeBipyeoXls(xls: Buffer, sidoName: string): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 6) return [];

  // Find party row (row with 한나라당 or 정당명 at col4+)
  let partyRowIdx = 4;
  for (let i = 2; i < Math.min(json.length, 8); i++) {
    const row = json[i] as (string | null)[];
    const hasParty = row.slice(4).some(v => v && String(v).trim().length > 1 &&
      !String(v).startsWith("[") &&
      !String(v).includes("득표") && !String(v).includes("무효") && !String(v).includes("기권") &&
      !String(v).includes("투표") && !String(v).includes("구시군") && !String(v).includes("선거"));
    if (hasParty) { partyRowIdx = i; break; }
  }

  const partyRow = json[partyRowIdx] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 4; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }
  if (endCol === partyRow.length - 1) endCol = partyRow.length - 3;

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 4; i < endCol; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name || name === "계" || name === "무효투표수" || name === "기권수") continue;
    partyCols.push({ idx: i, name });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  let currentSigungu = "";

  for (let r = partyRowIdx + 1; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const sigungu = String(row[0] ?? "").trim();
    const emd = String(row[1] ?? "").trim();

    if (!sigungu && !emd) continue;
    if (sigungu === "구시군명") continue; // 헤더 재출현
    // 시도 레벨 합계 행 skip (예: "서울특별시 합계")
    if (emd === "합계" && !currentSigungu && !sigungu) continue;
    // 읍면동 "합계" 행은 시군구 합계이므로 유지
    if (sigungu && sigungu !== "합계") currentSigungu = sigungu;

    const voters = toNum(row[2]);
    const votes = toNum(row[3]);

    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);
    if (validVotes === 0) continue;

    let kind: ParsedStationRow["kind"] = "subtotal";
    let emdName: string | null = emd || null;

    if (emd === "합계" || !emd) {
      kind = "total";
      emdName = null;
    } else if (emd === "거소투표" || emd === "관외사전투표") {
      kind = "abs";
    } else {
      kind = "subtotal";
    }

    result.push({
      sidoName,
      sigunguName: currentSigungu || sigungu,
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

  return result;
}

// 6회: per-sido zip 내 폴더에서 시도명 추출
function getSido6Hoe(filepath: string): string {
  const parts = filepath.split("/");
  const sidoFile = parts.find(p => p.includes("경상남도") || p.includes("경상북도") || p.includes("서울") || p.includes("부산") || p.includes("경기"));
  if (sidoFile?.includes("경상남도")) return "경상남도";
  if (sidoFile?.includes("경상북도")) return "경상북도";
  if (sidoFile?.includes("서울")) return "서울특별시";
  if (sidoFile?.includes("부산")) return "부산광역시";
  if (sidoFile?.includes("경기")) return "경기도";
  // 6회 zip은 별도 zip per sido — 이 함수 사용 시 이미 sido가 결정됨
  return "";
}

// ── Main parse functions ─────────────────────────────────────────────────────

export interface Jiseon36Result {
  elections: ParsedElection[];
  warnings: string[];
}

export async function parseJiseon36(outerZipPath: string): Promise<Jiseon36Result> {
  const outerZip = new AdmZip(outerZipPath);
  const allEntries = outerZip.getEntries();
  const warnings: string[] = [];

  const resultMap: Map<string, { rows: ParsedStationRow[]; partySet: Set<string> }> = new Map();

  function addRows(electionId: string, rows: ParsedStationRow[]) {
    if (!resultMap.has(electionId)) {
      resultMap.set(electionId, { rows: [], partySet: new Set() });
    }
    const entry = resultMap.get(electionId)!;
    for (const r of rows) {
      r.parties.forEach(p => entry.partySet.add(p.rawName));
      entry.rows.push(r);
    }
  }

  // ── 3회 (2002) 비례대표 ───────────────────────────────────────────────────────
  const bipropZip = allEntries.find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("3회") && n.includes("비례") && n.endsWith(".zip");
  });
  if (bipropZip) {
    const inner = new AdmZip(bipropZip.getData());
    for (const ie of inner.getEntries()) {
      if (ie.isDirectory) continue;
      const name = dec(Buffer.from(ie.rawEntryName));
      if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) continue;
      const sidoName = getSido3Hoe(name);
      const rows = parse3HoeBipyeo(ie.getData(), sidoName);
      addRows("2002-local-council-prop", rows);
    }
    const count = resultMap.get("2002-local-council-prop")?.rows.length ?? 0;
    console.log(`[3회 비례] 2002-local-council-prop: ${count} rows`);
  }

  // 3회 시도지사: BIFF5 포맷 xls, codepage 949 처리
  const gov3Entry = allEntries.find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("3회") && n.includes("시도지사") && n.endsWith(".zip");
  });
  if (gov3Entry) {
    const gov3zip = new AdmZip(gov3Entry.getData());
    for (const ie of gov3zip.getEntries()) {
      if (ie.isDirectory) continue;
      const iname = dec(Buffer.from(ie.rawEntryName));
      if (!iname.endsWith(".xls") && !iname.endsWith(".xlsx")) continue;
      const sidoName = getSido3Hoe(iname.split("/").pop() ?? iname);
      const rows = parse3HoeGovXls(ie.getData(), sidoName);
      addRows("2002-local-governor", rows);
    }
    const count = resultMap.get("2002-local-governor")?.rows.length ?? 0;
    console.log(`[3회 시도지사] 2002-local-governor: ${count} rows`);
  } else {
    warnings.push("3회 시도지사 zip을 찾을 수 없음");
  }

  // 3회 시군장: BIFF5 포맷 xls, codepage 949 처리
  const mayor3Entry = allEntries.find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("3회") && n.includes("시군장") && n.endsWith(".zip");
  });
  if (mayor3Entry) {
    const mayor3zip = new AdmZip(mayor3Entry.getData());
    for (const ie of mayor3zip.getEntries()) {
      if (ie.isDirectory) continue;
      const iname = dec(Buffer.from(ie.rawEntryName));
      if (!iname.endsWith(".xls") && !iname.endsWith(".xlsx")) continue;
      const fname = iname.split("/").pop() ?? iname;
      // 파일명이 시군구명 (e.g. "가평군.xls", "창원시.xls")
      const sigunguName = fname.replace(/\.xls(x)?$/, "");
      // 시도명은 시군구명으로 역추정 불가 — 추후 필요 시 regions lookup 활용
      // 여기서는 시군구명만 전달, sidoName은 빈값 (build-static에서 region lookup이 처리)
      const rows = parse3HoeMayorXls(ie.getData(), sigunguName);
      addRows("2002-local-mayor", rows);
    }
    const count = resultMap.get("2002-local-mayor")?.rows.length ?? 0;
    console.log(`[3회 시군장] 2002-local-mayor: ${count} rows`);
  } else {
    warnings.push("3회 시군장 zip을 찾을 수 없음");
  }

  // ── 4회 (2006) 시도지사 + 비례대표시도의원 ────────────────────────────────────
  // 4회 구조: 개별 xls per sigungu, path 포함 시도/시군구 파악
  const entries4 = allEntries.filter(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("제4회") && !e.isDirectory && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });

  // 1_시도지사: governor
  const gov4 = entries4.filter(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("1_시도지사");
  });
  for (const e of gov4) {
    const n = dec(Buffer.from(e.rawEntryName));
    const sidoName = extract4HoeSidoname(n);
    const sigungu = extract4HoeSimguname(n.split("/").pop() ?? "");
    const rows = parse4HoeXls(e.getData(), sidoName, sigungu);
    addRows("2006-local-governor", rows);
  }
  console.log(`[4회 시도지사] 2006-local-governor: ${resultMap.get("2006-local-governor")?.rows.length ?? 0} rows`);

  // 6_비례대표시도의원: council-prop
  const prop4 = entries4.filter(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("6_비례") || n.includes("6_비례대표");
  });
  for (const e of prop4) {
    const n = dec(Buffer.from(e.rawEntryName));
    const sidoName = extract4HoeSidoname(n);
    const sigungu = extract4HoeSimguname(n.split("/").pop() ?? "");
    const rows = parse4HoeXls(e.getData(), sidoName, sigungu);
    addRows("2006-local-council-prop", rows);
  }
  console.log(`[4회 비례] 2006-local-council-prop: ${resultMap.get("2006-local-council-prop")?.rows.length ?? 0} rows`);

  // ── 5회 (2010) 시도지사 + 광역의원비례 ───────────────────────────────────────
  const entries5Gov = allEntries.filter(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("제5회") && n.includes("01_시도지사") && !e.isDirectory && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });
  for (const e of entries5Gov) {
    const n = dec(Buffer.from(e.rawEntryName));
    const filename = n.split("/").pop() ?? "";
    const sidoName = getSido5Hoe(filename);
    const rows = parse5HoeXls(e.getData(), sidoName);
    addRows("2010-local-governor", rows);
  }
  console.log(`[5회 시도지사] 2010-local-governor: ${resultMap.get("2010-local-governor")?.rows.length ?? 0} rows`);

  const entries5Prop = allEntries.filter(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("제5회") && (n.includes("04_광역의원비례") || n.includes("광역의원비례")) && !e.isDirectory && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });
  for (const e of entries5Prop) {
    const n = dec(Buffer.from(e.rawEntryName));
    const filename = n.split("/").pop() ?? "";
    // 5회 파일명: "15_경상남도.xls" → extract sido
    const sidoName = getSido5HoeFromFilename(filename);
    const rows = parse5HoeBipyeoXls(e.getData(), sidoName);
    addRows("2010-local-council-prop", rows);
  }
  console.log(`[5회 비례] 2010-local-council-prop: ${resultMap.get("2010-local-council-prop")?.rows.length ?? 0} rows`);

  // ── 6회 (2014) — per-sido zip 처리 ──────────────────────────────────────────
  const zipEntries6 = allEntries.filter(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("제6회") && n.endsWith(".zip") && !e.isDirectory;
  });

  // sido name from zip filename
  const SIDO6_MAP: Record<string, string> = {
    "강원": "강원도", "경기": "경기도", "경남": "경상남도", "경북": "경상북도",
    "광주": "광주광역시", "대구": "대구광역시", "대전": "대전광역시", "부산": "부산광역시",
    "서울": "서울특별시", "세종": "세종특별자치시", "울산": "울산광역시", "인천": "인천광역시",
    "전남": "전라남도", "전북": "전라북도", "제주": "제주특별자치도", "충남": "충청남도", "충북": "충청북도",
  };

  // 6회 폴더명 → election id 매핑 (시도마다 이름이 다름)
  function getElectionId6HoeFolder(folder: string): string {
    if (folder.startsWith("01_")) return "2014-local-governor";
    if (folder.startsWith("02_")) return "2014-local-mayor";
    if (folder.startsWith("03_")) return "2014-local-council";
    if (folder.startsWith("04_")) return "2014-local-council-prop";
    if (folder.startsWith("05_")) return "2014-local-council-basic";
    if (folder.startsWith("06_")) return "2014-local-council-basic-prop";
    if (folder.startsWith("07_")) return "__skip__"; // 교육감
    return "";
  }

  // 6회 시도지사 파일 탐색: 표준 "01_" 폴더가 없는 시도 대응
  // 파일명·폴더명에 시장/도지사/시도지사 키워드로 매핑
  function isGovernorFile6Hoe(entryPath: string): boolean {
    // 표준 01_ 폴더
    const topFolder = entryPath.split("/")[0];
    if (topFolder.startsWith("01_")) return true;
    // 비표준 폴더/파일명 키워드 (경북: "읍면동별 개표자료/01_시도지사/경상북도.xlsx")
    if (entryPath.includes("시도지사") || entryPath.includes("도지사")) return true;
    // 대구: "1.시장/대구광역시.xls" — 폴더명이 "시장"으로 시작
    if (topFolder === "1.시장" || topFolder === "시장" || topFolder === "시도지사") return true;
    // 부산: "부산-시장-개표진행상황(읍면동별).xlsx" — 파일명에 "-시장-" 포함
    const fname = entryPath.split("/").pop() ?? "";
    if (fname.includes("-시장-") || fname.includes("시장선거")) return true;
    // 충북: 없음 → skip
    return false;
  }

  for (const zipEntry of zipEntries6) {
    const zipName = dec(Buffer.from(zipEntry.rawEntryName));
    // extract sido from filename: "...(경남).zip"
    let sidoName = "";
    const parenMatch = zipName.match(/\(([^)]+)\)\s*\.zip/);
    const shortName = parenMatch ? parenMatch[1].trim() : "";
    if (shortName && SIDO6_MAP[shortName]) {
      sidoName = SIDO6_MAP[shortName];
    } else {
      for (const [k, v] of Object.entries(SIDO6_MAP)) {
        if (zipName.includes(`(${k})`)) { sidoName = v; break; }
      }
    }
    if (!sidoName) {
      warnings.push(`6회 zip 시도명 미확인: ${zipName}`);
      continue;
    }

    const innerZip = new AdmZip(zipEntry.getData());

    // 시도지사 파일을 별도로 먼저 수집 (중복 파싱 방지)
    const govParsed = new Set<string>();

    for (const ie of innerZip.getEntries()) {
      if (ie.isDirectory) continue;
      const iname = dec(Buffer.from(ie.rawEntryName));
      if (!iname.endsWith(".xls") && !iname.endsWith(".xlsx")) continue;

      // determine election from folder (standard path)
      const folder = iname.split("/")[0];
      let electionId = getElectionId6HoeFolder(folder);

      // 비표준 경로의 시도지사 파일 대응
      if (!electionId && isGovernorFile6Hoe(iname)) {
        electionId = "2014-local-governor";
      }

      if (!electionId) continue;
      if (electionId === "__skip__") continue;

      // 중복 방지 (시도지사 파일을 두 번 파싱하지 않도록)
      if (electionId === "2014-local-governor") {
        if (govParsed.has(iname)) continue;
        govParsed.add(iname);
      }

      // 파일명에서 시군구명 추출 (일부 지역은 per-sigungu xls)
      const fname = iname.split("/").pop() ?? "";
      // "경상남도_거제시.xls" → "거제시", "서울특별시.xls" → undefined (per-sido xls)
      let sigunguOverride: string | undefined;
      const sigunguMatch = fname.match(/[^_]+_(.+?)\.xls/i);
      if (sigunguMatch) sigunguOverride = sigunguMatch[1];

      const rows = parse6HoeXls(ie.getData(), sidoName, sigunguOverride);
      addRows(electionId, rows);
    }
  }

  // 6회 결과 출력
  for (const [id, data] of resultMap.entries()) {
    if (id.startsWith("2014-")) {
      console.log(`[6회] ${id}: ${data.rows.length} rows`);
    }
  }

  // ── 결과 변환 ────────────────────────────────────────────────────────────────
  const DATES: Record<string, string> = {
    "2002-local-governor": "2002-06-13",
    "2002-local-mayor": "2002-06-13",
    "2002-local-council-prop": "2002-06-13",
    "2006-local-governor": "2006-05-31",
    "2006-local-council-prop": "2006-05-31",
    "2010-local-governor": "2010-06-02",
    "2010-local-council-prop": "2010-06-02",
    "2014-local-governor": "2014-06-04",
    "2014-local-mayor": "2014-06-04",
    "2014-local-council": "2014-06-04",
    "2014-local-council-prop": "2014-06-04",
    "2014-local-council-basic": "2014-06-04",
    "2014-local-council-basic-prop": "2014-06-04",
    "2014-local-superintendent": "2014-06-04",
  };

  const elections: ParsedElection[] = [];
  for (const [id, data] of resultMap.entries()) {
    elections.push({
      electionId: id,
      electionDate: DATES[id] ?? "",
      rows: data.rows,
      partyNames: [...data.partySet],
    });
  }

  return { elections, warnings };
}

// ── Main ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const zipPath = "/Users/ahbaik/Downloads/전국동시지방선거 개표결과(제3회~제6회).zip";
  const outDir = "data/parsed";
  mkdirSync(outDir, { recursive: true });

  parseJiseon36(zipPath).then(({ elections, warnings }) => {
    if (warnings.length > 0) {
      console.warn("[경고]", warnings.join("\n  "));
    }
    for (const e of elections) {
      if (e.rows.length === 0) {
        console.warn(`skip (0 rows): ${e.electionId}`);
        continue;
      }
      const outPath = path.join(outDir, `${e.electionId}.json`);
      writeFileSync(outPath, JSON.stringify(e));
      console.log(`✓ ${e.electionId}: rows=${e.rows.length} parties=${e.partyNames.length}`);
    }
  }).catch(e => { console.error(e); process.exit(1); });
}
