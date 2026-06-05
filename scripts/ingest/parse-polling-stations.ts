// raw HTML 디렉터리(`data/raw/polling-stations/{electionId}/{necElectionId}-{cityCode}-{townCode}.html`)
// → 처리된 JSON (`data/processed/polling-stations/{electionId}.json`)
//
// 실행: pnpm tsx scripts/ingest/parse-polling-stations.ts <electionId>
//
// Phase 5.2 fetcher 가 raw 파일을 생성한 뒤 본 스크립트를 호출.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseVccp08Stations,
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
  stationCount: number;
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

  // 선거별 서브디렉터리: data/raw/polling-stations/{electionId}/
  const RAW_DIR = path.join(RAW_BASE, electionId);

  if (!existsSync(RAW_DIR)) {
    console.error(`raw dir 없음: ${RAW_DIR}`);
    console.error("Phase 5.2 fetcher 를 먼저 실행해야 함.");
    process.exit(1);
  }

  const all = await readdir(RAW_DIR);
  const targets = all
    .map((n) => ({ name: n, meta: parseFilename(n) }))
    .filter((x) => x.meta !== null) as { name: string; meta: { cityCode: string; townCode: string } }[];

  if (targets.length === 0) {
    console.error(`매칭 raw 파일 없음 (electionId=${electionId})`);
    process.exit(1);
  }

  const bundle: ElectionBundle = {
    electionId,
    files: [],
    totalRows: 0,
    stationCount: 0,
    noDataFiles: 0,
  };

  for (const t of targets) {
    const html = await readFile(path.join(RAW_DIR, t.name), "utf-8");
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
    bundle.stationCount += r.rows.filter((x) => x.kind === "station").length;
  }

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${electionId}.json`);
  await writeFile(outPath, JSON.stringify(bundle, null, 2));

  console.log(`✓ ${outPath}`);
  console.log(
    `  files=${bundle.files.length} (no-data=${bundle.noDataFiles}) ` +
    `rows=${bundle.totalRows} stations=${bundle.stationCount}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
