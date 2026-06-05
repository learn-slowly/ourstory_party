// raw HTML 수집: 한 electionId 의 모든 (cityCode, townCode) 조합을
// 동시성 5 로 받아 data/raw/polling-stations/ 에 캐시.
//
// 실행: pnpm ingest:fetch-polling-stations <electionId> [--refresh]
//
// race 종류 분기:
//   necCode 1 (대통령), 3 (광역단체장), 11 (교육감) → 시·도 단위만 (townCode 생략)
//   그 외 → 시·도 × townCode 조합

import { eq } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db } from "../../src/lib/db-admin";
import { elections } from "../../db/schema";
import { CITY_CODES, fetchTownCodes } from "./lib/nec-codes";
import { fetchOne, type FetchParams } from "./lib/nec-fetch";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 선거별 서브디렉터리 사용 — parse 스크립트가 electionId 로 매칭
const RAW_BASE = path.join(HERE, "..", "..", "data", "raw", "polling-stations");
const CONCURRENCY = 5;

// race 종류 → (시·도 단위 only / 시·군·구까지 / VCCP08 vs VCCP04)
function planRace(necCode: string, isLive: boolean): {
  sigunguLevel: boolean;
  endpoint: "VCCP08" | "VCCP04";
  electionType: string;
} {
  // NEC 가 모든 race 를 sigungu 단위로 데이터 제공 (라이브든 historical 이든).
  // 라이브 대선·광역단체장·교육감 도 sigungu 단위 응답 확인됨 (2025 대선 진주시 4803 → 121KB + 투표구별 row).
  void isLive; // 향후 다른 분기 케이스 위해 파라미터 유지
  const sigunguLevel = true;
  // necCode → electionType
  const typeMap: Record<string, string> = {
    "1": "1", // 대통령
    "2": "2", // 국회 지역구
    "3": "4", "4": "4", "5": "4", "6": "4", "8": "4", "9": "4", "11": "4", // 지방
    "7": "2", // 국회 비례
  };
  const electionType = typeMap[necCode] ?? "4";
  // 라이브 NEC 모듈 (electionId 0020YYMMDD) — VCCP08 가 station + 정당/후보자 응답.
  // 역대 archive (electionId 0000000000):
  //   대선(necCode=1) → VCCP08 (station × 후보자 분해 응답 — 2017·2022·2025 확인)
  //   그 외 (총선 지역구·비례·지선·보궐·교육감) → VCCP04 (emd × 정당/후보자 분해)
  //     archive VCCP08 은 대선 외에는 "후보자별 득표수" colspan=1 단일 합만 줌 → 정당 매핑 불가
  const useVccp08OnArchive = necCode === "1";
  const endpoint: "VCCP08" | "VCCP04" = isLive || useVccp08OnArchive ? "VCCP08" : "VCCP04";
  return { sigunguLevel, endpoint, electionType };
}

// 동시성 풀 — N개 까지만 동시에 await
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
  const electionId = process.argv[2];
  const refresh = process.argv.includes("--refresh");
  if (!electionId) {
    console.error("usage: tsx fetch-polling-stations.ts <electionId> [--refresh]");
    process.exit(2);
  }

  const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${electionId}`);
    await sql.end();
    process.exit(1);
  }
  if (!election.necElectionId || !election.necCode || !election.date) {
    console.error(`necElectionId·necCode·date 미설정: ${electionId}`);
    await sql.end();
    process.exit(1);
  }

  const dateYmd = String(election.date).replace(/-/g, "");
  const necCode = election.necCode;
  const necElectionId = election.necElectionId;
  // 라이브 vs 역대 — seed.necElectionId 에 따라 결정.
  // necElectionId === "0000000000" → 역대 endpoint (electionName 으로 필터).
  // 그 외 (예: "0020250603") → NEC 가 여전히 라이브 module 에 데이터 보존중 → 라이브 endpoint.
  // (이전 todayStr 비교는 잘못된 휴리스틱 — NEC 가 일부 라이브 데이터를 archive 이후에도 보존함)
  // NEC 라이브 모듈에 데이터 있는 election 은 station-level 정당 응답 (VCCP08 라이브) 가능.
  // 그 외 archive 는 emd-level 정당 응답 (VCCP04). seed.necElectionId !== "0000000000" 면
  // 라이브 시도, 빈응답이면 archive fallback.
  const hasLive = necElectionId !== "0000000000";
  const livePlan = planRace(necCode, true);
  const archivePlan = planRace(necCode, false);

  console.log(
    `▶ ${electionId} necCode=${election.necCode} ` +
      `hasLive=${hasLive} (live ${livePlan.endpoint} → archive ${archivePlan.endpoint} fallback) refresh=${refresh}`,
  );

  // (cityCode, townCode?) 조합 생성 — 라이브·archive 두 후보 준비
  type Target = { live?: FetchParams; archive: FetchParams };
  const targets: Target[] = [];
  for (const city of CITY_CODES) {
    if (!livePlan.sigunguLevel && !archivePlan.sigunguLevel) {
      const base = (p: typeof livePlan): Omit<FetchParams, "electionId" | "townCode"> => ({
        electionName: dateYmd,
        electionType: p.electionType,
        electionCode: necCode,
        cityCode: city.code,
        endpoint: p.endpoint,
      });
      targets.push({
        live: hasLive ? { ...base(livePlan), electionId: necElectionId } : undefined,
        archive: { ...base(archivePlan), electionId: "0000000000" },
      });
      continue;
    }
    let towns;
    try {
      // townCode 목록 조회는 항상 현재 active 한 라이브 ID 사용 — 과거 election ID 로는 빈 응답.
      towns = await fetchTownCodes("0020250603", city.code);
    } catch (e) {
      console.warn(`  townCode 조회 실패 ${city.name}: ${(e as Error).message}`);
      continue;
    }
    for (const t of towns) {
      const base = (p: typeof livePlan): Omit<FetchParams, "electionId"> => ({
        electionName: dateYmd,
        electionType: p.electionType,
        electionCode: necCode,
        cityCode: city.code,
        townCode: t.code,
        endpoint: p.endpoint,
      });
      targets.push({
        live: hasLive ? { ...base(livePlan), electionId: necElectionId } : undefined,
        archive: { ...base(archivePlan), electionId: "0000000000" },
      });
    }
  }

  console.log(`  대상: ${targets.length} 호출`);

  const CACHE_DIR = path.join(RAW_BASE, electionId);

  let ok = 0, noData = 0, failed = 0, cached = 0, fallbackUsed = 0;
  await pool(targets, CONCURRENCY, async (t) => {
    // 라이브 먼저 시도 — 빈 응답이면 archive
    let r: Awaited<ReturnType<typeof fetchOne>> | null = null;
    if (t.live) {
      const r1 = await fetchOne(t.live, CACHE_DIR, { refresh });
      if (r1.status === "ok") r = r1;
    }
    if (r === null) {
      r = await fetchOne(t.archive, CACHE_DIR, { refresh });
      if (t.live && r.status === "ok") fallbackUsed++;
    }
    if (r.cached) cached++;
    if (r.status === "ok") ok++;
    else if (r.status === "no-data") noData++;
    else failed++;
  });

  console.log(
    `✓ ok=${ok} no-data=${noData} failed=${failed} cached=${cached}/${targets.length}` +
      (fallbackUsed > 0 ? ` (archive fallback=${fallbackUsed})` : ""),
  );
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
