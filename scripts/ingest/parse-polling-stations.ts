// raw HTML 디렉터리(`data/raw/polling-stations/{electionId}/{necElectionId}-{cityCode}-{townCode}.html`)
// → 처리된 JSON (`data/processed/polling-stations/{electionId}.json`)
//
// 실행: pnpm tsx scripts/ingest/parse-polling-stations.ts <electionId>
//
// Phase 5.2 fetcher 가 raw 파일을 생성한 뒤 본 스크립트를 호출.

import { eq } from "drizzle-orm";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db } from "../../src/lib/db-admin";
import { elections } from "../../db/schema";
import {
  parseVccp08Stations,
  parseVccp04District,
  type ParsedStationRow,
} from "./lib/nec-html";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_BASE = path.join(HERE, "..", "..", "data", "raw", "polling-stations");
const OUT_DIR = path.join(HERE, "..", "..", "data", "processed", "polling-stations");

interface ParsedFile {
  cityCode: string;
  townCode: string;
  partyNames: string[];
  rows: ParsedStationRow[];
}

interface ElectionBundle {
  electionId: string;
  files: ParsedFile[];
  // 합산 통계 — 디버깅·검증용
  totalRows: number;
  emdBreakdownCount: number;  // el_day(emd 선거일) 행 수 — 적재된 emd 수 추정 지표
  noDataFiles: number;
}

function parseFilename(name: string): {
  cityCode: string;
  townCode: string;
} | null {
  // 패턴: {necElectionId}-{cityCode}-{townCode}.html (fetcher 가 생성)
  if (!name.endsWith(".html")) return null;
  const stem = name.slice(0, -".html".length);
  // necElectionId 는 10자리 숫자
  const m = stem.match(/^\d{10}-(\d{4})-(\w+)$/);
  if (!m) return null;
  return { cityCode: m[1], townCode: m[2] };
}

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("usage: tsx parse-polling-stations.ts <electionId>");
    process.exit(2);
  }

  // election.necCode 보고 parser 선택 — 지역구(2/6) 는 parseVccp04District (선거구별 후보자명 처리)
  const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${electionId}`);
    await sql.end();
    process.exit(1);
  }
  const isDistrict = election.necCode === "2" || election.necCode === "6";
  console.log(`▶ ${electionId} necCode=${election.necCode} parser=${isDistrict ? "parseVccp04District" : "parseVccp08Stations"}`);

  // 선거별 서브디렉터리: data/raw/polling-stations/{electionId}/
  const RAW_DIR = path.join(RAW_BASE, electionId);

  if (!existsSync(RAW_DIR)) {
    console.error(`raw dir 없음: ${RAW_DIR}`);
    console.error("Phase 5.2 fetcher 를 먼저 실행해야 함.");
    await sql.end();
    process.exit(1);
  }

  const all = await readdir(RAW_DIR);
  const targets = all
    .map((n) => ({ name: n, meta: parseFilename(n) }))
    .filter((x) => x.meta !== null) as { name: string; meta: { cityCode: string; townCode: string } }[];

  if (targets.length === 0) {
    console.error(`매칭 raw 파일 없음 (electionId=${electionId})`);
    await sql.end();
    process.exit(1);
  }

  const bundle: ElectionBundle = {
    electionId,
    files: [],
    totalRows: 0,
    emdBreakdownCount: 0,
    noDataFiles: 0,
  };

  for (const t of targets) {
    const html = await readFile(path.join(RAW_DIR, t.name), "utf-8");
    if (isDistrict) {
      // 지역구: 먼저 parseVccp04District 시도 (다선거구 sigungu — 진주시갑/을 등).
      // no-data 면 parseVccp08Stations 로 fallback (단일 선거구 sigungu — 종로구 등,
      // 후보자명이 thead 에 위치). 둘 다 ParsedStationRow shape 로 평탄화.
      const dr = parseVccp04District(html);
      let rows: ParsedStationRow[] = [];
      let partyNames: string[] = [];
      if (dr.kind === "ok") {
        rows = dr.rows.map((d) => ({
          emdName: d.emdName,
          name: d.name,
          kind: d.kind,
          totalVoters: d.totalVoters,
          totalVotes: d.totalVotes,
          validVotes: d.validVotes,
          invalidVotes: d.invalidVotes,
          parties: d.candidates,
          district: d.district,
        }));
      } else {
        const sr = parseVccp08Stations(html);
        if (sr.kind === "no-data") {
          bundle.noDataFiles += 1;
          continue;
        }
        rows = sr.rows;
        partyNames = sr.partyNames;
      }
      bundle.files.push({
        cityCode: t.meta.cityCode,
        townCode: t.meta.townCode,
        partyNames,
        rows,
      });
      bundle.totalRows += rows.length;
      bundle.emdBreakdownCount += rows.filter((x) => x.kind === "el_day").length;
    } else {
      // 비례·대선·광역단체장·교육감 등: parseVccp08Stations (시·군·구 단위 단일 partyNames)
      const r = parseVccp08Stations(html);
      if (r.kind === "no-data") {
        bundle.noDataFiles += 1;
        continue;
      }
      bundle.files.push({
        cityCode: t.meta.cityCode,
        townCode: t.meta.townCode,
        partyNames: r.partyNames,
        rows: r.rows,
      });
      bundle.totalRows += r.rows.length;
      bundle.emdBreakdownCount += r.rows.filter((x) => x.kind === "el_day").length;
    }
  }

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${electionId}.json`);
  await writeFile(outPath, JSON.stringify(bundle, null, 2));

  console.log(`✓ ${outPath}`);
  console.log(
    `  files=${bundle.files.length} (no-data=${bundle.noDataFiles}) ` +
    `rows=${bundle.totalRows} emd=${bundle.emdBreakdownCount}`,
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
