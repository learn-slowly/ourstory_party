// processed JSON (Phase 5.1 parse-polling-stations 결과) 을 Supabase 에 upsert.
//
// 실행: pnpm ingest:polling-stations <electionId>
//
// 단계:
//   1) data/processed/polling-stations/{electionId}.json 로드
//   2) regions 매핑 + party 매핑
//   3) trans-batch upsert (polling_stations 먼저 → 그 id 로 votes/totals)
//   4) 검증 리포트 (station 수, 매핑률, vote_totals cross-check)

import { eq, sql as drizzleSql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db } from "../../src/lib/db-admin";
import {
  elections,
  pollingStations,
  pollingStationVotes,
  pollingStationTotals,
} from "../../db/schema";
import { createRegionResolver } from "./lib/region-resolver";
import { loadAliases } from "./lib/party-mapping-loader";
import { resolvePartyId } from "./lib/party-mapping";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.join(HERE, "..", "..", "data", "processed", "polling-stations");

interface ParsedStationRow {
  emdName: string | null;
  name: string;
  kind: "el_day" | "station" | "presub" | "abs" | "absentee" | "overseas" | "misc";
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  parties: { name: string; votes: number }[];
}

interface ParsedFile {
  cityCode: string;
  townCode: string;
  partyNames: string[];
  rows: ParsedStationRow[];
}

interface Bundle {
  electionId: string;
  files: ParsedFile[];
}

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("usage: tsx ingest-polling-stations.ts <electionId>");
    process.exit(2);
  }

  const jsonPath = path.join(PROCESSED_DIR, `${electionId}.json`);
  if (!existsSync(jsonPath)) {
    console.error(`processed JSON 없음: ${jsonPath}`);
    console.error("먼저 pnpm ingest:fetch-polling-stations 와 pnpm ingest:parse-polling-stations 실행");
    process.exit(1);
  }

  const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${electionId}`);
    await sql.end();
    process.exit(1);
  }

  const bundle = JSON.parse(await readFile(jsonPath, "utf-8")) as Bundle;
  console.log(`▶ ${electionId} files=${bundle.files.length}`);

  const resolver = await createRegionResolver();
  const aliases = await loadAliases();
  // election.date 는 drizzle date 타입이므로 문자열로 변환
  const electionDate = String(election.date);

  // 지역구는 후보자명 ("더불어민주당갈상돈") 형식이라 exact alias 매칭 실패.
  // prefix match (가장 긴 매칭 alias) 로 정당 추출. 비례·대선 등은 exact 만으로 충분.
  const isDistrict = election.necCode === "2" || election.necCode === "6";

  // resolvePartyId 캐시 (같은 raw name 반복 호출 회피)
  const partyCache = new Map<string, string | null>();
  function partyOf(rawName: string): string | null {
    if (partyCache.has(rawName)) return partyCache.get(rawName)!;
    let id = resolvePartyId(rawName, electionDate, aliases);
    if (id === null && isDistrict) {
      // prefix match — 후보자명 시작과 일치하는 가장 긴 valid alias 찾기 (≥3자)
      let best: { len: number; partyId: string } | null = null;
      for (const a of aliases) {
        if (a.alias.length >= 3 && rawName.startsWith(a.alias)) {
          const afterOk = !a.valid_from || a.valid_from <= electionDate;
          const beforeOk = !a.valid_until || electionDate <= a.valid_until;
          if (afterOk && beforeOk && (!best || a.alias.length > best.len)) {
            best = { len: a.alias.length, partyId: a.party_id };
          }
        }
      }
      id = best?.partyId ?? null;
    }
    partyCache.set(rawName, id);
    return id;
  }

  // 카운터
  let stationsInserted = 0;
  let votesInserted = 0;
  let totalsInserted = 0;
  let voteRowsMapped = 0;
  let voteRowsUnmapped = 0;
  const unmappedPartyNames = new Map<string, number>();
  let regionMissCount = 0;

  for (const file of bundle.files) {
    const sigunguCode = await resolver.sigunguCode(file.cityCode, file.townCode);
    if (!sigunguCode) {
      console.warn(`  regions 매핑 실패: city=${file.cityCode} town=${file.townCode}`);
      regionMissCount += file.rows.length;
      continue;
    }

    // 한 파일(시·군·구) 단위로 batch upsert — row-by-row insert 는 network round-trip 비용으로 60분+ 걸려서 안 됨
    const stationValues = file.rows.map((row) => ({
      electionId,
      sigunguCode,
      emdCode: row.emdName ? resolver.emdCode(sigunguCode, row.emdName) : null,
      name: row.name,
      kind: row.kind,
      necTownCode: file.townCode,
    }));

    await db.transaction(async (tx) => {
      // 1) stations 일괄 upsert — RETURNING id 가 INSERT 순서 보장 (Postgres)
      const inserted = await tx
        .insert(pollingStations)
        .values(stationValues)
        .onConflictDoUpdate({
          target: [
            pollingStations.electionId,
            pollingStations.sigunguCode,
            pollingStations.emdCode,
            pollingStations.name,
          ],
          set: {
            kind: drizzleSql`excluded.kind`,
            necTownCode: drizzleSql`excluded.nec_town_code`,
          },
        })
        .returning({ id: pollingStations.id });
      stationsInserted += inserted.length;

      // 2) totals 일괄 upsert
      const totalsValues = file.rows.map((row, i) => ({
        stationId: inserted[i].id,
        totalVoters: row.totalVoters,
        totalVotes: row.totalVotes,
        validVotes: row.validVotes,
        invalidVotes: row.invalidVotes,
      }));
      await tx
        .insert(pollingStationTotals)
        .values(totalsValues)
        .onConflictDoUpdate({
          target: pollingStationTotals.stationId,
          set: {
            totalVoters: drizzleSql`excluded.total_voters`,
            totalVotes: drizzleSql`excluded.total_votes`,
            validVotes: drizzleSql`excluded.valid_votes`,
            invalidVotes: drizzleSql`excluded.invalid_votes`,
          },
        });
      totalsInserted += totalsValues.length;

      // 3) votes 일괄 upsert (한 파일의 모든 row × parties 평탄화)
      const voteValues: {
        stationId: number;
        partyId: string | null;
        rawName: string;
        votes: number;
      }[] = [];
      for (let i = 0; i < file.rows.length; i++) {
        const row = file.rows[i];
        const stationId = inserted[i].id;
        for (const p of row.parties) {
          const partyId = partyOf(p.name);
          if (partyId) voteRowsMapped += 1;
          else {
            voteRowsUnmapped += 1;
            unmappedPartyNames.set(
              p.name,
              (unmappedPartyNames.get(p.name) ?? 0) + p.votes,
            );
          }
          voteValues.push({ stationId, partyId, rawName: p.name, votes: p.votes });
        }
      }
      if (voteValues.length > 0) {
        await tx
          .insert(pollingStationVotes)
          .values(voteValues)
          .onConflictDoUpdate({
            target: [pollingStationVotes.stationId, pollingStationVotes.rawName],
            set: {
              partyId: drizzleSql`excluded.party_id`,
              votes: drizzleSql`excluded.votes`,
            },
          });
        votesInserted += voteValues.length;
      }
    });
  }

  console.log(
    `\n✓ 적재 완료\n` +
      `  stations: ${stationsInserted}\n` +
      `  votes:    ${votesInserted}\n` +
      `  totals:   ${totalsInserted}`,
  );
  console.log(
    `\n매핑률\n` +
      `  vote rows: ${voteRowsMapped}/${voteRowsMapped + voteRowsUnmapped} (${(
        (voteRowsMapped / Math.max(1, voteRowsMapped + voteRowsUnmapped)) * 100
      ).toFixed(1)}%)\n` +
      `  region miss: ${regionMissCount} rows`,
  );

  if (unmappedPartyNames.size > 0) {
    const top = [...unmappedPartyNames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log("\n매핑 실패 정당명 top 5 (raw_name | 누적 votes):");
    for (const [name, v] of top) console.log(`  ${name} | ${v}`);
  }

  // ── 검증 게이트 ──
  console.log("\n── 검증 게이트 ──");

  // 1) emd 분해 sanity — 전국 emd 약 3,500 ±10%
  const emdCountRows = await sql<{ n: number }[]>`
    SELECT count(DISTINCT emd_code)::int AS n
    FROM polling_stations
    WHERE election_id = ${electionId} AND kind = 'el_day'
  `;
  const emdCount = emdCountRows[0]?.n ?? 0;
  const inRange = emdCount >= 3150 && emdCount <= 3850; // 3,500 ±10%
  console.log(`  [${inRange ? "PASS" : "WARN"}] emd 분해 수: ${emdCount} (목표 3,500 ±10%, el_day 행 기준)`);

  // 2) partyId 매핑률
  const mappingRows = await sql<{ mapped: number; total: number }[]>`
    SELECT
      sum(case when v.party_id is not null then 1 else 0 end)::int AS mapped,
      count(*)::int AS total
    FROM polling_station_votes v
    JOIN polling_stations s ON s.id = v.station_id
    WHERE s.election_id = ${electionId}
  `;
  const mappingPct = mappingRows[0]?.total
    ? (mappingRows[0].mapped / mappingRows[0].total) * 100
    : 0;
  const mappingOk = mappingPct >= 95;
  console.log(
    `  [${mappingOk ? "PASS" : "FAIL"}] 매핑률: ${mappingPct.toFixed(1)}% ` +
      `(${mappingRows[0]?.mapped}/${mappingRows[0]?.total})`,
  );

  // 3) cross-check vs vote_totals (sigungu 단위 합) — el_day + presub + 외부 메타 전부 포함
  const crossRows = await sql<{
    region_code: string;
    party_id: string;
    polling_sum: number;
    totals_sum: number;
  }[]>`
    WITH p AS (
      SELECT s.sigungu_code AS region_code, v.party_id, sum(v.votes)::int AS sum_v
      FROM polling_station_votes v
      JOIN polling_stations s ON s.id = v.station_id
      WHERE s.election_id = ${electionId} AND v.party_id IS NOT NULL
      GROUP BY s.sigungu_code, v.party_id
    ),
    t AS (
      SELECT region_code, party_id, votes
      FROM vote_totals
      WHERE election_id = ${electionId}
    )
    SELECT
      coalesce(p.region_code, t.region_code) AS region_code,
      coalesce(p.party_id, t.party_id)       AS party_id,
      coalesce(p.sum_v, 0)::int              AS polling_sum,
      coalesce(t.votes, 0)::int              AS totals_sum
    FROM p
    FULL OUTER JOIN t ON p.region_code = t.region_code AND p.party_id = t.party_id
    WHERE coalesce(p.region_code, t.region_code) IN (
      SELECT code FROM regions WHERE level = 'sigungu'
    )
  `;
  let crossPass = 0;
  let crossFail = 0;
  const failSamples: { region_code: string; party_id: string; polling_sum: number; totals_sum: number }[] = [];
  for (const r of crossRows) {
    const denom = Math.max(r.polling_sum, r.totals_sum, 1);
    const diffPct = (Math.abs(r.polling_sum - r.totals_sum) / denom) * 100;
    if (diffPct <= 0.5) crossPass += 1;
    else {
      crossFail += 1;
      if (failSamples.length < 2) failSamples.push(r);
    }
  }
  const crossOk = crossFail === 0;
  console.log(
    `  [${crossOk ? "PASS" : "WARN"}] cross-check: ${crossPass} pass / ${crossFail} fail ` +
      `(±0.5% 기준, ${crossRows.length} (sigungu × party) 비교)`,
  );
  if (failSamples.length > 0) {
    console.log("  cross-check fail 샘플:");
    for (const s of failSamples) {
      console.log(
        `    region=${s.region_code} party=${s.party_id} ` +
          `polling=${s.polling_sum} totals=${s.totals_sum}`,
      );
    }
  }

  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
