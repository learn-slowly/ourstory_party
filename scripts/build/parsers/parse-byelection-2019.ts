// scripts/build/parsers/parse-byelection-2019.ts
// 2019 4·3 재·보궐 (창원성산·통영고성 국회의원) parsed JSON 생성.
// raw HTML: data/raw/byelection-2019/{townCode}.html  (NEC info.nec.go.kr VCCP04 archive)
// 출력: data/parsed/2019-byelection-changwon.json + 2019-byelection-tongyeong.json
//
// 변환 흐름:
//   parseVccp04District → ParsedDistrictRow[]
//   → emd 단위 합산 row (kind="el_day") + presub/abs/absentee 별도 보존
//   → ParsedStationRow[] (parse-nec-xlsx 와 동일 포맷)
//
// 통영고성은 "통영시고성군" 한 선거구가 두 시·군(통영시·고성군) 으로 분리 응답 → 한 election JSON 에 통합.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { ParsedElection, ParsedStationRow } from "../lib/types";

// 보궐 응답 구조 (2019 4·3, archive VCCP04):
//   thead r0: 선거구명·읍면동명·구분·선거인수·투표수·후보자별 득표수·무효투표수·기권자수
//   thead r1: 후보 N + 계
//   tbody:   합계(c0=시·군·구, c1=합계) → 거소·관외·국외 메타 → emd 단위 (c1=emdName, c2=계|관내사전|선거일투표)
// 컬럼: [선거구명(0), 읍면동명(1), 구분(2), 선거인수(3), 투표수(4), 후보 N개, 계(N+5), 무효, 기권]
//
// nec-html.ts 의 parseVccp04District 는 후보자명을 tbody 의 후보자 헤더 행에서 찾음 → 보궐은 thead 라 매칭 안 됨.
// parseVccp08Stations 는 leading=3 응답을 처리하지 않음.
// → 보궐 전용 inline parser.

interface ParsedDistrictRow {
  emdName: string | null;
  name: string;
  kind: "el_day" | "station" | "presub" | "abs" | "absentee" | "overseas" | "misc";
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  candidates: { name: string; votes: number }[];
}

const META_LABELS_VCCP04 = new Map<string, ParsedDistrictRow["kind"]>([
  ["관내사전투표", "presub"],
  ["관외사전투표", "abs"],
  ["거소·선상투표", "absentee"],
  ["거소ㆍ선상투표", "absentee"],
  ["거소투표", "absentee"],
  ["재외투표", "overseas"],
  ["재외국민투표", "overseas"],
  ["국외부재자투표", "overseas"],
  ["선거일투표", "el_day"],
]);

const META_HEADERS = new Set([
  "선거구명", "읍면동명", "투표구명", "구분", "선거인수", "투표수",
  "정당별 득표수", "후보자별 득표수",
  "계", "무효", "무효투표수", "기권자수",
]);

function parseByelection2019Html(html: string): { rows: ParsedDistrictRow[]; partyNames: string[] } | null {
  const $ = cheerio.load(html);
  const tbodyTrs = $("table#table01 tbody tr");
  if (tbodyTrs.length === 0) return null;
  const firstCellText = tbodyTrs.first().find("td").first().text().trim();
  if (
    firstCellText.includes("검색된 결과가 없습니다") ||
    firstCellText.includes("조회된 자료가 없습니다") ||
    firstCellText.includes("무투표")
  ) {
    return null;
  }

  // 후보자명 — thead 모든 th 에서 META 제외
  const candidates: string[] = [];
  $("table#table01 thead th").each((_i, th) => {
    const t = $(th).text().trim();
    if (!t || META_HEADERS.has(t)) return;
    candidates.push(t);
  });
  if (candidates.length === 0) return null;

  const num = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const rows: ParsedDistrictRow[] = [];
  let currentEmd: string | null = null;

  // 컬럼: c0=선거구명, c1=emdName/메타, c2=구분, c3=선거인수, c4=투표수, c5..N=후보자 N, N+5=계, +1=무효, +2=기권
  tbodyTrs.each((_i, tr) => {
    const cells = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    const minCols = 5 + candidates.length + 3;
    if (cells.length < minCols) return;

    const c0 = cells[0], c1 = cells[1], c2 = cells[2];

    // 합계 행 — 시·군·구 합계, vote_totals 중복이라 skip (parse-byelection 은 emd 단위로 재합산)
    if (c1 === "합계") return;

    // emd "계" 행 — currentEmd 갱신, 자체는 skip
    if (c1 && c2 === "계" && !META_LABELS_VCCP04.has(c1)) {
      currentEmd = c1;
      return;
    }

    // top-level 메타 — c1 에 메타 라벨, c2=빈
    const topMeta = META_LABELS_VCCP04.get(c1);
    const perEmdMeta = META_LABELS_VCCP04.get(c2);

    let kind: ParsedDistrictRow["kind"];
    let emdName: string | null;
    let displayName: string;
    if (topMeta && !currentEmd) {
      kind = topMeta;
      emdName = null;
      displayName = c1;
    } else if (perEmdMeta) {
      kind = perEmdMeta;
      emdName = currentEmd;
      displayName = c2;
    } else if (c2) {
      kind = "station";
      emdName = currentEmd;
      displayName = c2;
    } else {
      return;
    }

    const partyStart = 5;
    const tailStart = partyStart + candidates.length;
    rows.push({
      emdName,
      name: displayName,
      kind,
      totalVoters: num(cells[3]),
      totalVotes: num(cells[4]),
      validVotes: num(cells[tailStart]),
      invalidVotes: num(cells[tailStart + 1]),
      candidates: candidates.map((name, i) => ({ name, votes: num(cells[partyStart + i]) })),
    });
    void c0;  // 보궐은 한 응답에 한 선거구 — 선거구명 별도 사용 안 함
  });

  return { rows, partyNames: candidates };
}

interface RawSource {
  townCode: string;
  sigunguName: string;  // NEC town 이름 (build:static SIGUNGU_PREFIX_STRIP 적용 대상)
  htmlPath: string;
}

interface ByElectionTarget {
  electionId: string;
  electionDate: string;
  sources: RawSource[];
}

const RAW_DIR = path.resolve("data/raw/byelection-2019");
const TARGETS: ByElectionTarget[] = [
  {
    electionId: "2019-byelection-changwon",
    electionDate: "2019-04-03",
    sources: [
      { townCode: "4822", sigunguName: "창원시성산구", htmlPath: path.join(RAW_DIR, "4822.html") },
    ],
  },
  {
    electionId: "2019-byelection-tongyeong",
    electionDate: "2019-04-03",
    sources: [
      { townCode: "4805", sigunguName: "통영시", htmlPath: path.join(RAW_DIR, "4805.html") },
      { townCode: "4806", sigunguName: "고성군", htmlPath: path.join(RAW_DIR, "4806.html") },
    ],
  },
];

const SIDO_NAME = "경상남도";

// ParsedDistrictRow → emd 단위 합산 ParsedStationRow + 메타 행 (presub/abs/absentee) 그대로.
function convertDistrictRows(
  rows: ParsedDistrictRow[],
  sigunguName: string,
  partyNames: Set<string>,
): ParsedStationRow[] {
  // emd 단위 (관내사전 + 선거일투표) 합산 — aggregate-region 이 el_day 만 sigungu/sido 로 roll-up
  const emdAgg = new Map<
    string,
    {
      totalVoters: number;
      totalVotes: number;
      validVotes: number;
      invalidVotes: number;
      parties: Map<string, number>;
    }
  >();

  const extra: ParsedStationRow[] = [];

  for (const r of rows) {
    // 후보자명 partyNames 누적
    for (const c of r.candidates) partyNames.add(c.name);

    if (r.kind === "presub" || r.kind === "el_day" || r.kind === "station") {
      if (!r.emdName) continue;
      if (!emdAgg.has(r.emdName)) {
        emdAgg.set(r.emdName, {
          totalVoters: 0, totalVotes: 0, validVotes: 0, invalidVotes: 0, parties: new Map(),
        });
      }
      const a = emdAgg.get(r.emdName)!;
      a.totalVoters += r.totalVoters;
      a.totalVotes += r.totalVotes;
      a.validVotes += r.validVotes;
      a.invalidVotes += r.invalidVotes;
      for (const c of r.candidates) {
        a.parties.set(c.name, (a.parties.get(c.name) ?? 0) + c.votes);
      }
      // presub 행은 PresubVsElDay 섹션용으로 그대로 보존
      if (r.kind === "presub") {
        extra.push({
          sidoName: SIDO_NAME, sigunguName, emdName: r.emdName, stationName: r.name,
          kind: "presub",
          totalVoters: r.totalVoters, totalVotes: r.totalVotes,
          validVotes: r.validVotes, invalidVotes: r.invalidVotes,
          parties: r.candidates.map((c) => ({ rawName: c.name, votes: c.votes })),
        });
      }
    } else {
      // top-level 메타 (abs/absentee/overseas/misc) — emd 귀속 안 함, 그대로 보존
      extra.push({
        sidoName: SIDO_NAME, sigunguName, emdName: null, stationName: r.name,
        kind: r.kind,
        totalVoters: r.totalVoters, totalVotes: r.totalVotes,
        validVotes: r.validVotes, invalidVotes: r.invalidVotes,
        parties: r.candidates.map((c) => ({ rawName: c.name, votes: c.votes })),
      });
    }
  }

  const elDayRows: ParsedStationRow[] = [];
  for (const [emdName, a] of emdAgg) {
    elDayRows.push({
      sidoName: SIDO_NAME, sigunguName, emdName, stationName: null,
      kind: "el_day",
      totalVoters: a.totalVoters, totalVotes: a.totalVotes,
      validVotes: a.validVotes, invalidVotes: a.invalidVotes,
      parties: [...a.parties.entries()].map(([rawName, votes]) => ({ rawName, votes })),
    });
  }
  return [...elDayRows, ...extra];
}

function buildElection(target: ByElectionTarget): ParsedElection {
  const allRows: ParsedStationRow[] = [];
  const partyNames = new Set<string>();
  for (const src of target.sources) {
    if (!existsSync(src.htmlPath)) {
      console.warn(`  skip ${src.townCode} — HTML 없음: ${src.htmlPath}`);
      continue;
    }
    const html = readFileSync(src.htmlPath, "utf-8");
    const res = parseByelection2019Html(html);
    if (!res) {
      console.warn(`  skip ${src.townCode} (${src.sigunguName}) — no-data`);
      continue;
    }
    const stationRows = convertDistrictRows(res.rows, src.sigunguName, partyNames);
    allRows.push(...stationRows);
    console.log(`  ✓ ${src.sigunguName} (${src.townCode}) — district rows=${res.rows.length} → station rows=${stationRows.length}`);
  }
  return {
    electionId: target.electionId,
    electionDate: target.electionDate,
    rows: allRows,
    partyNames: [...partyNames],
  };
}

async function main() {
  const outDir = path.resolve("data/parsed");
  for (const t of TARGETS) {
    console.log(`▶ ${t.electionId}`);
    const parsed = buildElection(t);
    const outPath = path.join(outDir, `${t.electionId}.json`);
    writeFileSync(outPath, JSON.stringify(parsed));
    console.log(`  → ${outPath}  rows=${parsed.rows.length}  parties=${parsed.partyNames.length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
