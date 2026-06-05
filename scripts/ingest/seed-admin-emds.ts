// NEC 응답(parsed JSON)에서 등장하는 행정동을 ourstory regions 에 보충 시드.
// ourstory regions seed (01-regions.ts) 는 법정동 기준이라 도시 지역 행정동(예: "거여1동",
// "풍납2동", "면목제3·8동") 가 직접 매칭 안 됨. 본 스크립트는 NEC 데이터에서 (sigungu_code,
// emdName) 유일 쌍을 추출해 regions 에 추가.
//
// 코드 체계: 법정동(10자리, 1~5XXXXXXXXX) 와 충돌 방지 위해 synthetic code `9` prefix 사용.
//   synthetic emd code = "9" + sigungu_code[5:10] + 4자리 running counter
//   예: 송파구(1171000000) → "9" + "00000" + "0001" = "9000000001"
//   ※ sigungu_code 마지막 5자리는 "00000" 으로 동일하므로 prefix(5)+sigungu(2)+seq(2) 로 안 됨.
//      → 다른 방식: sigungu_code 첫 4자리 + "9" + sigungu_code 5번째 + 4-자리 hash.
//   가장 단순 + unique: "9" + sigungu_code[0:4] + 5-자리 sequential per sigungu.
//   예: 송파구(1171000000) → "9" + "1171" + "00001" = "9117100001"
//
// 실행: pnpm tsx scripts/ingest/seed-admin-emds.ts <electionId>
//   해당 electionId 의 parsed JSON 만 읽음. 여러 electionId 적용하려면 반복 실행.

import { eq, sql as drizzleSql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db } from "../../src/lib/db-admin";
import { regions } from "../../db/schema";
import { createRegionResolver } from "./lib/region-resolver";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.join(HERE, "..", "..", "data", "processed", "polling-stations");

interface ParsedFile {
  cityCode: string;
  townCode: string;
  partyNames: string[];
  rows: Array<{
    emdName: string | null;
    name: string;
    kind: string;
  }>;
}

interface Bundle {
  electionId: string;
  files: ParsedFile[];
}

function syntheticCode(sigunguCode: string, seq: number): string {
  // 법정동 sigungu_code 는 XX_XX_X_00000 (앞 5자리가 sigungu 식별, 뒤 5자리 0).
  // synthetic emd code = "9" + sigungu_code[0:5] + 4자리 sequential = 10자리.
  // 화성시 본체(4159000000) prefix(5)="41590" / 화성시 분구(4159300000) prefix(5)="41593" 충돌 없음.
  const prefix = sigunguCode.slice(0, 5);
  return `9${prefix}${String(seq).padStart(4, "0")}`;
}

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("usage: tsx seed-admin-emds.ts <electionId>");
    process.exit(2);
  }

  const jsonPath = path.join(PROCESSED_DIR, `${electionId}.json`);
  if (!existsSync(jsonPath)) {
    console.error(`processed JSON 없음: ${jsonPath}`);
    process.exit(1);
  }

  const bundle = JSON.parse(await readFile(jsonPath, "utf-8")) as Bundle;
  const resolver = await createRegionResolver();

  // (sigungu_code, emdName) 유일 쌍 수집
  type Pair = { sigunguCode: string; emdName: string };
  const pairs = new Map<string, Pair>();
  for (const file of bundle.files) {
    const sigunguCode = await resolver.sigunguCode(file.cityCode, file.townCode);
    if (!sigunguCode) continue;
    for (const row of file.rows) {
      if (!row.emdName) continue;
      if (row.kind !== "el_day") continue;
      const key = `${sigunguCode}|${row.emdName}`;
      if (!pairs.has(key)) pairs.set(key, { sigunguCode, emdName: row.emdName });
    }
  }
  console.log(`NEC 데이터 unique (sigungu, emd) 쌍: ${pairs.size}`);

  // 이미 regions 에 있는 것 제외
  const missing: Pair[] = [];
  for (const p of pairs.values()) {
    if (resolver.emdCode(p.sigunguCode, p.emdName) === null) missing.push(p);
  }
  console.log(`regions 에 없어서 시드 필요: ${missing.length}`);

  if (missing.length === 0) {
    console.log("✓ 모든 행정동 이미 regions 에 매핑됨");
    await sql.end();
    return;
  }

  // sigungu_code 별 sequential 카운터 — 같은 sigungu 안에서 unique seq 부여.
  // 이미 등록된 synthetic 코드와 충돌 방지 위해 기존 최대 seq 부터 시작
  const existing = await sql<{ code: string; parent_code: string | null }[]>`
    SELECT code, parent_code FROM regions WHERE level = 'emd' AND code LIKE '9%'
  `;
  const nextSeqBySigungu = new Map<string, number>();
  for (const r of existing) {
    if (!r.parent_code) continue;
    // synthetic code 의 마지막 4자리가 seq
    const seq = Number(r.code.slice(6));
    const cur = nextSeqBySigungu.get(r.parent_code) ?? 0;
    nextSeqBySigungu.set(r.parent_code, Math.max(cur, seq));
  }

  // INSERT 새 행정동
  const toInsert: Array<{ code: string; level: "emd"; name: string; parentCode: string }> = [];
  for (const p of missing) {
    const cur = (nextSeqBySigungu.get(p.sigunguCode) ?? 0) + 1;
    nextSeqBySigungu.set(p.sigunguCode, cur);
    toInsert.push({
      code: syntheticCode(p.sigunguCode, cur),
      level: "emd",
      name: p.emdName,
      parentCode: p.sigunguCode,
    });
  }

  // 배치 insert (500 chunks). UNIQUE 위반은 가능성 낮음 (이미 missing 만 골랐고 동시성 없음).
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    await db
      .insert(regions)
      .values(chunk)
      .onConflictDoUpdate({
        target: regions.code,
        set: { name: drizzleSql`excluded.name`, parentCode: drizzleSql`excluded.parent_code` },
      });
  }

  console.log(`✓ INSERTed ${toInsert.length} admin emds`);
  console.log(`  sample: ${toInsert.slice(0, 3).map((r) => `${r.code} ${r.name}`).join(", ")}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
