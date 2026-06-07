// scripts/build/parsers/parse-jiseon-7.ts
// 2018 제7회 전국동시지방선거 읍면동별 개표자료 zip 파서
//
// 파일 구조:
//   01-시도지사: 선거종류(0), 선거구명(1), 시도명(2), 구시군명(3), 읍면동명(4), 구분(5), 선거인수(6), 투표수(7), parties(8..N-2), 무효(N-1), 기권(N)
//   02-구시군의장: 선거종류(0), 시도(1), 선거구명(2), 시도명(3), 구시군명(4), 읍면동명(5), 구분(6), 선거인수(7), 투표수(8), parties(9...)
//   03-시도의회의원: 동일 구조
//   04-구시군의회의원: 동일 구조
//   05-광역비례: 선거종류(0), 시도(1), 시도명(2), 구시군명(3), 읍면동명(4), 구분(5), 선거인수(6), 투표수(7), parties(8..N-1), 계(N)
//   06-기초비례: 선거종류(0), 시도(1), 선거구명(2), 시도명(3), 구시군명(4), 읍면동명(5), 구분(6), 선거인수(7), 투표수(8), parties(9..N-1), 계(N), 무효, 기권
//   07-교육감: 선거종류(0), 선거구명(1), 시도명(2), 구시군명(3), 읍면동명(4), 구분(5), ... → skip (무정당)
//
// 구분 값: "계" = 시군구 합계, 읍면동명 = 읍면동별, "거소투표"/"사전투표" = 특수

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

function extractPartyName(raw: string | null): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const lines = s.split(/\r?\n/);
  return lines[0].trim();
}

interface JiseonLayout {
  sidoCol: number;
  sigunguCol: number;
  emdCol: number;
  gubunCol: number;
  votersCol: number;
  votesCol: number;
  partyStartCol: number;
}

// 각 xlsx의 row1 구조에서 layout 자동 감지
function detectJiseon7Layout(json: (string | number | null)[][]): JiseonLayout | null {
  const row0 = json[0] as (string | null)[];
  if (!row0) return null;

  // row1에서 정당 헤더가 있는 위치 파악
  const row1 = json[1] as (string | null)[];

  // 01-시도지사, 05-광역비례 계열: col0=선거종류, col1=선거구명, col2=시도명, col3=구시군명, col4=읍면동명, col5=구분
  if (row0[2] && String(row0[2]).includes("시도명") && !row0[1]?.toString().includes("시도")) {
    return { sidoCol: 2, sigunguCol: 3, emdCol: 4, gubunCol: 5, votersCol: 6, votesCol: 7, partyStartCol: 8 };
  }
  // 광역비례 계열: col0=선거종류, col1=시도, col2=시도명, col3=구시군명, col4=읍면동명, col5=구분
  if (row0[1] && !row0[2]?.toString().includes("선거구") && row0[2]?.toString().includes("시도")) {
    return { sidoCol: 2, sigunguCol: 3, emdCol: 4, gubunCol: 5, votersCol: 6, votesCol: 7, partyStartCol: 8 };
  }
  // 시도지사 계열 (col1=선거구명, col2=시도명)
  if (row0[1] && String(row0[1] ?? "").includes("선거구") && row0[2]?.toString()?.includes("시도")) {
    return { sidoCol: 2, sigunguCol: 3, emdCol: 4, gubunCol: 5, votersCol: 6, votesCol: 7, partyStartCol: 8 };
  }
  // 구시군장/시도의회/구시군의회/기초비례: col0=선거종류, col1=시도, col2=선거구명, col3=시도명, col4=구시군명, col5=읍면동명, col6=구분
  return { sidoCol: 3, sigunguCol: 4, emdCol: 5, gubunCol: 6, votersCol: 7, votesCol: 8, partyStartCol: 9 };
}

function parseJiseon7Sheet(
  sheet: XLSX.WorkSheet,
  electionId: string
): ParsedStationRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 3) return [];

  const layout = detectJiseon7Layout(json);
  if (!layout) return [];

  // row1: party names at partyStartCol
  const partyRow = json[1] as (string | null)[];
  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = layout.partyStartCol; i < partyRow.length; i++) {
    const n = partyRow[i];
    if (!n) continue;
    const name = extractPartyName(String(n));
    if (!name || name === "계" || name === "무효투표수" || name === "기권수") break;
    partyCols.push({ idx: i, name });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];

  for (let r = 2; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const sido = String(row[layout.sidoCol] ?? "").trim();
    const sigungu = String(row[layout.sigunguCol] ?? "").trim();
    const emd = String(row[layout.emdCol] ?? "").trim();
    const gubun = String(row[layout.gubunCol] ?? "").trim();

    if (!sido && !sigungu) continue;
    if (sido === "합계" || sigungu === "합계") continue; // skip nationwide total

    const voters = toNum(row[layout.votersCol]);
    const votes = toNum(row[layout.votesCol]);
    const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }));
    const validVotes = parties.reduce((a, b) => a + b.votes, 0);

    if (validVotes === 0) continue;

    // 구분에 따라 kind 결정
    let emdName: string | null = null;
    let kind: ParsedStationRow["kind"] = "subtotal";

    if (gubun === "계" || gubun === "") {
      // 시군구 합계 (emd=시군구명, gubun="계")
      if (!emd) {
        kind = "total";
        emdName = null;
      } else {
        // emd가 있으면 읍면동 합계 행
        emdName = emd;
        kind = "subtotal";
      }
    } else if (gubun === "거소투표") {
      kind = "abs";
      emdName = emd || null;
    } else if (gubun === "관외사전투표" || gubun === "사전투표") {
      kind = "presub";
      emdName = emd || null;
    } else {
      // gubun = 읍면동명 (소계, 투표구별)
      emdName = gubun !== "합계" ? (emd || gubun) : null;
      kind = gubun === "합계" ? "total" : "subtotal";
    }

    result.push({
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

  return result;
}

// 파일명 → election 메타
interface FileMeta {
  id: string;
  skipReason?: string;
}

const FILE_MAP: Record<string, FileMeta> = {
  "20180619-7지선-01-(시도지사)_읍면동별개표자료.xlsx": { id: "2018-local-governor" },
  "20180619-7지선-02-(구시군의장)_읍면동별개표자료.xlsx": { id: "2018-local-mayor" },
  "20180619-7지선-03-(시도의회의원)_읍면동별개표자료.xlsx": { id: "2018-local-council" },
  "20180619-7지선-04-(구시군의회의원)_읍면동별개표자료.xlsx": { id: "2018-local-council-basic" },
  "20180619-7지선-05-(광역비례)_읍면동별개표자료.xlsx": { id: "2018-local-council-prop" },
  "20180619-7지선-06-(기초비례)_읍면동별개표자료.xlsx": { id: "2018-local-council-basic-prop" },
  "20180619-7지선-07-(교육감)_읍면동별개표자료.xlsx": { id: "2018-local-superintendent", skipReason: "무정당" },
  "20180619-7지선-08-(교육의원)_읍면동별개표자료.xlsx": { id: "2018-local-edu-council", skipReason: "무정당" },
  "20180619-7지선-09-(국회의원재보궐)_읍면동별개표자료.xlsx": { id: "2018-local-national-assembly", skipReason: "부분재보궐" },
};

const DATES: Record<string, string> = {
  "2018-local-governor": "2018-06-13",
  "2018-local-mayor": "2018-06-13",
  "2018-local-council": "2018-06-13",
  "2018-local-council-basic": "2018-06-13",
  "2018-local-council-prop": "2018-06-13",
  "2018-local-council-basic-prop": "2018-06-13",
  "2018-local-superintendent": "2018-06-13",
};

export function parseJiseon7(zipPath: string): ParsedElection[] {
  const zip = new AdmZip(zipPath);
  const outputs: Map<string, ParsedElection> = new Map();

  for (const entry of zip.getEntries()) {
    const filename = dec(Buffer.from(entry.rawEntryName));
    const meta = FILE_MAP[filename];
    if (!meta) {
      console.warn(`[parse-jiseon-7] 미매핑: ${filename}`);
      continue;
    }
    if (meta.skipReason) {
      console.log(`[parse-jiseon-7] skip (${meta.skipReason}): ${filename}`);
      continue;
    }
    if (entry.isDirectory) continue;

    const wb = XLSX.read(entry.getData(), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = parseJiseon7Sheet(sheet, meta.id);
    const partySet = new Set<string>();
    rows.forEach(r => r.parties.forEach(p => partySet.add(p.rawName)));

    console.log(`[parse-jiseon-7] ${filename}: ${rows.length} rows`);

    outputs.set(meta.id, {
      electionId: meta.id,
      electionDate: DATES[meta.id] ?? "2018-06-13",
      rows,
      partyNames: [...partySet],
    });
  }

  return [...outputs.values()];
}

// ── Main ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const zipPath = "/Users/ahbaik/Downloads/전국동시지방선거 개표결과(제7회).zip";
  const outDir = "data/parsed";
  mkdirSync(outDir, { recursive: true });

  const results = parseJiseon7(zipPath);
  for (const r of results) {
    writeFileSync(path.join(outDir, `${r.electionId}.json`), JSON.stringify(r));
    console.log(`✓ ${r.electionId}: rows=${r.rows.length} parties=${r.partyNames.length}`);
  }
}
