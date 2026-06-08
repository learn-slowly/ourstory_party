// scripts/build/parsers/fetch-parse-2008-general-prop.ts
// 2008 18대 비례 NEC archive 시·군 단위 호출 → 합계 행 추출 → parsed JSON.
// 16~19대 zip 에는 18대 비례가 없어 별도 수집.
//
// 호출 파라미터:
//   electionId=0000000000 (archive)
//   electionName=20080409
//   electionType=2  electionCode=7  (국회의원 비례)
//   cityCode × townCode (시·군) — 시·도 합계 endpoint 없음, 각 시·군 1회 호출
//
// 파서: thead 에서 정당명 추출 → tbody r0 "합계" 1행만 추출 (kind="total").
// emd/station 행은 보강 목적 외라 skip. aggregate-region 의 else 분기가 total 로 sigungu·sido 합산.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { ParsedElection, ParsedStationRow } from "../lib/types";

const NEC_BASE = "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml";
const TOWN_API = "http://info.nec.go.kr/bizcommon/selectbox/selectbox_townCodeJson.json";
const RAW_DIR = path.resolve("data/raw/2008-general-prop/nec-archive");
const OUT_PATH = path.resolve("data/parsed/2008-general-prop.json");
const CONCURRENCY = 5;
const TIMEOUT_MS = 8000;
const MAX_RETRY = 3;

const CITIES = [
  { code: "1100", name: "서울특별시" },
  { code: "2600", name: "부산광역시" },
  { code: "2700", name: "대구광역시" },
  { code: "2800", name: "인천광역시" },
  { code: "2900", name: "광주광역시" },
  { code: "3000", name: "대전광역시" },
  { code: "3100", name: "울산광역시" },
  // 2008 시점엔 세종(5100) 없음
  { code: "4100", name: "경기도" },
  { code: "5200", name: "강원특별자치도" },  // 2008 시점 = 강원도, 시·도명만 추후 보충 시 변환 필요
  { code: "4300", name: "충청북도" },
  { code: "4400", name: "충청남도" },
  { code: "5300", name: "전북특별자치도" },  // 2008 = 전라북도
  { code: "4600", name: "전라남도" },
  { code: "4700", name: "경상북도" },
  { code: "4800", name: "경상남도" },
  { code: "4900", name: "제주특별자치도" },  // 2008 = 제주특별자치도 (2006 승격)
];

const META_HEADERS = new Set([
  "선거구명", "읍면동명", "투표구명", "구분", "선거인수", "투표수",
  "정당별 득표수", "후보자별 득표수",
  "계", "무효", "무효투표수", "기권자수",
]);

interface TownCode { code: string; name: string }

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
  throw new Error(`${label} 실패: ${lastErr}`);
}

async function fetchTownCodes(cityCode: string): Promise<TownCode[]> {
  // 라이브 electionId 가 가장 안정적 — 역대 0000000000 로는 빈 응답
  const url = `${TOWN_API}?electionId=0020250603&cityCode=${cityCode}`;
  const text = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } }, `townCode ${cityCode}`);
  const json = JSON.parse(text) as { jsonResult?: { body?: Array<{ CODE: string; NAME: string }> } };
  return (json.jsonResult?.body ?? []).map((r) => ({ code: r.CODE, name: r.NAME }));
}

async function fetchOneTown(cityCode: string, townCode: string): Promise<string> {
  const cachePath = path.join(RAW_DIR, `${cityCode}-${townCode}.html`);
  if (existsSync(cachePath)) return readFileSync(cachePath, "utf-8");

  const body = new URLSearchParams({
    electionId: "0000000000",
    electionName: "20080409",
    requestURI: "/electioninfo/0000000000/vc/vccp04.jsp",
    topMenuId: "VC",
    secondMenuId: "VCCP04",
    menuId: "VCCP04",
    statementId: "VCCP04_#2_0",
    electionType: "2",
    electionCode: "7",
    cityCode,
    townCode,
    searchMode: "1",
  });
  const html = await fetchWithRetry(
    NEC_BASE,
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" } },
    `${cityCode}-${townCode}`,
  );
  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
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

  const cells = tbodyTrs.first().find("td").map((_, td) => $(td).text().trim().replace(/,/g, "")).get();
  // leading=1: [c0=합계, c1=선거인수, c2=투표수, c3..c(3+N-1)=정당, c(3+N)=계, +1=무효, +2=기권]
  const partyStart = 3;
  const tailStart = partyStart + partyNames.length;
  if (cells.length < tailStart + 3) return null;
  const num = (s: string) => Number(s) || 0;
  return {
    totalVoters: num(cells[1]),
    totalVotes: num(cells[2]),
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

// NEC town 이름 → seed sigungu 이름 정규화 (build-static.ts 의 SIGUNGU_PREFIX_STRIP 과 일관)
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

async function main() {
  console.log("▶ 2008 18대 비례 NEC archive 수집");
  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

  // 17 시·도 × townCode 조회
  const targets: { cityName: string; cityCode: string; townCode: string; townName: string }[] = [];
  for (const city of CITIES) {
    let towns: TownCode[] = [];
    try {
      towns = await fetchTownCodes(city.code);
    } catch (e) {
      console.warn(`  townCode 조회 실패 ${city.name}: ${(e as Error).message}`);
      continue;
    }
    for (const t of towns) {
      targets.push({ cityName: city.name, cityCode: city.code, townCode: t.code, townName: t.name });
    }
  }
  console.log(`  대상: ${targets.length} 시·군 호출`);

  // 동시성 풀 호출
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();
  let ok = 0, noData = 0, failed = 0;

  await pool(targets, CONCURRENCY, async (t) => {
    try {
      const html = await fetchOneTown(t.cityCode, t.townCode);
      const agg = parseAggregateRow(html);
      if (!agg) {
        noData++;
        return;
      }
      ok++;
      agg.parties.forEach((p) => partySet.add(p.rawName));
      allRows.push({
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
      console.warn(`  ✗ ${t.cityName} ${t.townName}: ${(e as Error).message}`);
    }
  });

  console.log(`  결과: ok=${ok}, no-data=${noData}, failed=${failed}, rows=${allRows.length}`);
  console.log(`  정당 수: ${partySet.size}`);

  const parsed: ParsedElection = {
    electionId: "2008-general-prop",
    electionDate: "2008-04-09",
    rows: allRows,
    partyNames: [...partySet],
  };
  writeFileSync(OUT_PATH, JSON.stringify(parsed));
  console.log(`  → ${OUT_PATH}`);
  void readdirSync; // 사용 안 함 — import 정리용
}

main().catch((e) => { console.error(e); process.exit(1); });
