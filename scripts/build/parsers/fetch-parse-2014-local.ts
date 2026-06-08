// scripts/build/parsers/fetch-parse-2014-local.ts
// 2014 6회 지선 7종 (governor·mayor·council/-prop·council-basic/-prop·superintendent) 풀 NEC archive 수집.
// 기존 raw zip 에 6 시·도만 수록 — 17 시·도 다 호출해서 누락 11 시·도 보강.
//
// 한 race 당 17 시·도 × townCode 호출 (시·도 단위는 응답 없음 → 시·군 단위 필수).
// race × townCode 매트릭스 = 약 1500 호출, 동시성 5 로 ~8 분 예상.
//
// 출력: data/parsed/2014-local-{race}.json (기존 6 시·도 데이터와 합쳐 17 시·도 풀커버리지).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { ParsedElection, ParsedStationRow } from "../lib/types";

const NEC_BASE = "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml";
const TOWN_API = "http://info.nec.go.kr/bizcommon/selectbox/selectbox_townCodeJson.json";
const RAW_BASE = path.resolve("data/raw/2014-local-nec-archive");
const PARSED_OUT = path.resolve("data/parsed");
const CONCURRENCY = 5;
const TIMEOUT_MS = 10000;
const MAX_RETRY = 3;

interface CityCode { code: string; name: string }
const CITIES: CityCode[] = [
  { code: "1100", name: "서울특별시" },
  { code: "2600", name: "부산광역시" },
  { code: "2700", name: "대구광역시" },
  { code: "2800", name: "인천광역시" },
  { code: "2900", name: "광주광역시" },
  { code: "3000", name: "대전광역시" },
  { code: "3100", name: "울산광역시" },
  { code: "5100", name: "세종특별자치시" },
  { code: "4100", name: "경기도" },
  { code: "5200", name: "강원특별자치도" },  // 2014 = 강원도
  { code: "4300", name: "충청북도" },
  { code: "4400", name: "충청남도" },
  { code: "5300", name: "전북특별자치도" },  // 2014 = 전라북도
  { code: "4600", name: "전라남도" },
  { code: "4700", name: "경상북도" },
  { code: "4800", name: "경상남도" },
  { code: "4900", name: "제주특별자치도" },
];

// 2014 지선 race 정의 — necCode/electionType
// 시·도지사·교육감은 시·도 단위 (sigunguLevel=false), 나머지는 시·군 단위.
// 단 NEC archive 는 시·도 단위 호출 시 빈 응답 → 모든 race 가 시·군 단위.
interface RaceDef { electionId: string; necCode: string; electionType: string }
const RACES: RaceDef[] = [
  { electionId: "2014-local-governor", necCode: "3", electionType: "4" },
  { electionId: "2014-local-mayor", necCode: "4", electionType: "4" },
  { electionId: "2014-local-council", necCode: "5", electionType: "4" },
  { electionId: "2014-local-council-prop", necCode: "8", electionType: "4" },
  { electionId: "2014-local-council-basic", necCode: "6", electionType: "4" },
  { electionId: "2014-local-council-basic-prop", necCode: "9", electionType: "4" },
  { electionId: "2014-local-superintendent", necCode: "11", electionType: "4" },
];

const META_HEADERS = new Set([
  "선거구명", "읍면동명", "투표구명", "구분", "선거인수", "투표수",
  "정당별 득표수", "후보자별 득표수",
  "계", "무효", "무효투표수", "기권자수",
]);

const SIGUNGU_PREFIX_STRIP: Record<string, string> = {
  "창원시의창구": "의창구",
  "창원시성산구": "성산구",
  "창원시마산합포구": "마산합포구",
  "창원시마산회원구": "마산회원구",
  "창원시진해구": "진해구",
};
function normSigungu(raw: string): string {
  return SIGUNGU_PREFIX_STRIP[raw] ?? raw;
}

async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<string> {
  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...init, signal: ctrl.signal });
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        if (r.status < 500) break;
      } else {
        const text = await r.text();
        clearTimeout(t);
        return text;
      }
    } catch (e) {
      lastErr = (e as Error).message;
    } finally {
      clearTimeout(t);
    }
    await new Promise((res) => setTimeout(res, 800 * 2 ** (attempt - 1)));
  }
  throw new Error(`${label}: ${lastErr}`);
}

async function fetchTownCodes(cityCode: string): Promise<{ code: string; name: string }[]> {
  const url = `${TOWN_API}?electionId=0020250603&cityCode=${cityCode}`;
  const text = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } }, `townCode ${cityCode}`);
  const json = JSON.parse(text) as { jsonResult?: { body?: Array<{ CODE: string; NAME: string }> } };
  return (json.jsonResult?.body ?? []).map((r) => ({ code: r.CODE, name: r.NAME }));
}

async function fetchRaceTown(race: RaceDef, cityCode: string, townCode: string): Promise<string> {
  const cacheDir = path.join(RAW_BASE, race.electionId);
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${cityCode}-${townCode}.html`);
  if (existsSync(cachePath)) return readFileSync(cachePath, "utf-8");

  const body = new URLSearchParams({
    electionId: "0000000000",
    electionName: "20140604",
    requestURI: "/electioninfo/0000000000/vc/vccp04.jsp",
    topMenuId: "VC",
    secondMenuId: "VCCP04",
    menuId: "VCCP04",
    statementId: "VCCP04_#2_0",
    electionType: race.electionType,
    electionCode: race.necCode,
    cityCode,
    townCode,
    searchMode: "1",
  });
  const html = await fetchWithRetry(
    NEC_BASE,
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" } },
    `${race.electionId} ${cityCode}-${townCode}`,
  );
  writeFileSync(cachePath, html, "utf-8");
  return html;
}

interface AggRow {
  totalVoters: number; totalVotes: number; validVotes: number; invalidVotes: number;
  parties: { rawName: string; votes: number }[];
}

function parseAggregateRow(html: string): AggRow | null {
  const $ = cheerio.load(html);
  const tbodyTrs = $("table#table01 tbody tr");
  if (tbodyTrs.length === 0) return null;
  const firstCellText = tbodyTrs.first().find("td").first().text().trim();
  if (
    firstCellText.includes("검색된 결과가 없습니다") ||
    firstCellText.includes("조회된 자료가 없습니다") ||
    firstCellText.includes("무투표")
  ) return null;
  if (firstCellText !== "합계") return null;

  const partyNames: string[] = [];
  $("table#table01 thead th").each((_i, th) => {
    const t = $(th).text().trim();
    if (!t || META_HEADERS.has(t)) return;
    partyNames.push(t);
  });
  if (partyNames.length === 0) return null;

  // leading 동적 — "선거인수" 컬럼이 thead 첫 행 어디 있는지
  const headerThs = $("table#table01 thead tr").first().find("th").map((_, c) => $(c).text().trim()).get() as string[];
  const votersIdx = headerThs.indexOf("선거인수");
  const leading = votersIdx > 0 ? votersIdx : 1;

  const cells = tbodyTrs.first().find("td").map((_, td) => $(td).text().trim().replace(/,/g, "")).get();
  // leading=1: [합계, 선거인수, 투표수, 정당N, 계, 무효, 기권]
  // leading=2: [읍면동명, 구분, 선거인수, 투표수, 정당N, 계, 무효, 기권]
  // leading=3: [선거구명, 읍면동명, 구분, 선거인수, 투표수, 정당N, 계, 무효, 기권]
  const votersCellIdx = leading;
  const votesCellIdx = leading + 1;
  const partyStart = leading + 2;
  const tailStart = partyStart + partyNames.length;
  if (cells.length < tailStart + 3) return null;
  const num = (s: string) => Number(s) || 0;
  return {
    totalVoters: num(cells[votersCellIdx]),
    totalVotes: num(cells[votesCellIdx]),
    validVotes: num(cells[tailStart]),
    invalidVotes: num(cells[tailStart + 1]),
    parties: partyNames.map((rawName, i) => ({ rawName, votes: num(cells[partyStart + i]) })),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log("▶ 2014 지선 7 race × 17 시·도 NEC archive 수집");

  // 17 시·도 townCode 먼저
  const cityTowns: { cityName: string; cityCode: string; townCode: string; townName: string }[] = [];
  for (const city of CITIES) {
    try {
      const towns = await fetchTownCodes(city.code);
      for (const t of towns) cityTowns.push({ cityName: city.name, cityCode: city.code, townCode: t.code, townName: t.name });
    } catch (e) {
      console.warn(`  townCode 조회 실패 ${city.name}: ${(e as Error).message}`);
    }
  }
  console.log(`  매트릭스: ${RACES.length} race × ${cityTowns.length} 시·군 = ${RACES.length * cityTowns.length} 호출`);

  for (const race of RACES) {
    console.log(`\n  [${race.electionId}]`);
    const rows: ParsedStationRow[] = [];
    const partySet = new Set<string>();
    let ok = 0, noData = 0, failed = 0;
    await pool(cityTowns, CONCURRENCY, async (t) => {
      try {
        const html = await fetchRaceTown(race, t.cityCode, t.townCode);
        const agg = parseAggregateRow(html);
        if (!agg) { noData++; return; }
        ok++;
        agg.parties.forEach((p) => partySet.add(p.rawName));
        rows.push({
          sidoName: t.cityName,
          sigunguName: normSigungu(t.townName),
          emdName: null,
          stationName: null,
          kind: "total",
          totalVoters: agg.totalVoters,
          totalVotes: agg.totalVotes,
          validVotes: agg.validVotes,
          invalidVotes: agg.invalidVotes,
          parties: agg.parties,
        });
      } catch (e) {
        failed++;
        console.warn(`    ✗ ${t.cityName} ${t.townName}: ${(e as Error).message}`);
      }
    });
    console.log(`    ok=${ok}, no-data=${noData}, failed=${failed}, parties=${partySet.size}`);

    // 기존 parsed 가 있으면 기존 rows + 신규 rows 합치기 (election_id+sidoName+sigunguName 중복 제거)
    const outPath = path.join(PARSED_OUT, `${race.electionId}.json`);
    const existing: ParsedElection | null = existsSync(outPath)
      ? JSON.parse(readFileSync(outPath, "utf-8"))
      : null;
    let allRows: ParsedStationRow[] = rows;
    let allParties = new Set<string>(partySet);
    if (existing) {
      // 신규 rows 의 sigungu set
      const newSigSet = new Set(rows.map((r) => `${r.sidoName}|${r.sigunguName}|${r.kind}`));
      // 기존 rows 중 신규에 없는 것만 유지
      const keptOld = existing.rows.filter(
        (r) => !newSigSet.has(`${r.sidoName}|${r.sigunguName}|${r.kind}`),
      );
      allRows = [...keptOld, ...rows];
      existing.partyNames.forEach((n) => allParties.add(n));
    }
    const out: ParsedElection = {
      electionId: race.electionId,
      electionDate: "2014-06-04",
      rows: allRows,
      partyNames: [...allParties],
    };
    writeFileSync(outPath, JSON.stringify(out));
    console.log(`    → ${outPath}  rows=${allRows.length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
