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
function planRace(necCode: string): {
  sigunguLevel: boolean;
  endpoint: "VCCP08" | "VCCP04";
  electionType: string;
} {
  const sigunguOnly = new Set(["1", "3", "11"]);
  const sigunguLevel = !sigunguOnly.has(necCode);
  // necCode → electionType
  const typeMap: Record<string, string> = {
    "1": "1", // 대통령
    "2": "2", // 국회 지역구
    "3": "4", "4": "4", "5": "4", "6": "4", "8": "4", "9": "4", "11": "4", // 지방
    "7": "2", // 국회 비례
  };
  const electionType = typeMap[necCode] ?? "4";
  // 지역구(2)·기초의원지역구(6) 는 VCCP04 권장 (후보자명 행 포함). 그 외 VCCP08.
  const endpoint: "VCCP08" | "VCCP04" =
    (necCode === "2" || necCode === "6") ? "VCCP04" : "VCCP08";
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
  const plan = planRace(election.necCode);
  const isLive = election.necElectionId !== "0000000000";

  console.log(
    `▶ ${electionId} necCode=${election.necCode} ` +
      `endpoint=${plan.endpoint} sigungu=${plan.sigunguLevel} live=${isLive} refresh=${refresh}`,
  );

  // (cityCode, townCode?) 조합 생성
  const targets: FetchParams[] = [];
  for (const city of CITY_CODES) {
    if (!plan.sigunguLevel) {
      targets.push({
        electionId: isLive ? election.necElectionId : "0000000000",
        electionName: dateYmd,
        electionType: plan.electionType,
        electionCode: election.necCode,
        cityCode: city.code,
        endpoint: plan.endpoint,
      });
      continue;
    }
    // townCode 목록 조회
    let towns;
    try {
      towns = await fetchTownCodes(
        isLive ? election.necElectionId : "0020250603", // 역대도 임의 electionId 면 됨
        city.code,
      );
    } catch (e) {
      console.warn(`  townCode 조회 실패 ${city.name}: ${(e as Error).message}`);
      continue;
    }
    for (const t of towns) {
      targets.push({
        electionId: isLive ? election.necElectionId : "0000000000",
        electionName: dateYmd,
        electionType: plan.electionType,
        electionCode: election.necCode,
        cityCode: city.code,
        townCode: t.code,
        endpoint: plan.endpoint,
      });
    }
  }

  console.log(`  대상: ${targets.length} 호출`);

  // 선거별 서브디렉터리: data/raw/polling-stations/{electionId}/
  const CACHE_DIR = path.join(RAW_BASE, electionId);

  let ok = 0, noData = 0, failed = 0, cached = 0;
  await pool(targets, CONCURRENCY, async (p) => {
    const r = await fetchOne(p, CACHE_DIR, { refresh });
    if (r.cached) cached++;
    if (r.status === "ok") ok++;
    else if (r.status === "no-data") noData++;
    else failed++;
  });

  console.log(
    `✓ ok=${ok} no-data=${noData} failed=${failed} cached=${cached}/${targets.length}`,
  );
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
