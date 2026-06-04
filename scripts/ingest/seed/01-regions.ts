import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import iconv from "iconv-lite";
import { sql as drizzleSql } from "drizzle-orm";
import { sql, db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.join(HERE, "..", "..", "..", "data", "seed", "legaldong-source.txt");

  const buf = await readFile(SRC);
  const text = iconv.decode(buf, "euc-kr");
  const lines = text.split(/\r?\n/).filter(Boolean);

  // 법정동코드 10자리. 시·도=마지막 8자리 0, 시·군·구=마지막 5자리 0, 읍·면·동=나머지
  function levelOf(code: string): "sido" | "sigungu" | "emd" {
    if (code.endsWith("00000000")) return "sido";
    if (code.endsWith("00000")) return "sigungu";
    return "emd";
  }

  function parentOf(code: string): string | null {
    const lv = levelOf(code);
    if (lv === "sido") return null;
    if (lv === "sigungu") return code.slice(0, 2) + "00000000";
    return code.slice(0, 5) + "00000";
  }

  interface Row { code: string; name: string; status: string; }

  const rows: Row[] = lines
    .map((line) => {
      const [code, name, status] = line.split("\t");
      return { code, name, status };
    })
    // 헤더 행과 폐지 행 제거
    .filter((r) => r.code && /^\d{10}$/.test(r.code) && r.status === "존재");

  // 실제 존재하는 sido 코드 집합 (외래키 안전을 위해 참조 전 확인용)
  const sidoCodes = new Set(
    rows.filter((r) => levelOf(r.code) === "sido").map((r) => r.code)
  );

  console.log(`총 ${rows.length} 행 — 시·도/시·군/읍·면·동 분류 후 적재`);

  // 시·도 먼저 → 시·군 → 읍·면·동 순서 (외래키 안전)
  for (const lv of ["sido", "sigungu", "emd"] as const) {
    const subset = rows.filter((r) => levelOf(r.code) === lv);
    console.log(`  ${lv}: ${subset.length}건`);

    // 시·도/시·군 의 name 은 마지막 토큰 사용 ("서울특별시 종로구" → "종로구")
    const batch = subset.map((r) => {
      const tokens = r.name.split(/\s+/);
      const displayName = tokens[tokens.length - 1];
      const parent = parentOf(r.code);
      // 부모 sido 코드가 파일에 없는 경우(예: 세종특별자치시 3600000000)는 null 처리
      const resolvedParent =
        lv === "sigungu" && parent && !sidoCodes.has(parent) ? null : parent;
      return {
        code: r.code,
        level: lv,
        name: displayName,
        parentCode: resolvedParent,
      };
    });

    // 배치 upsert (500개씩 — pooler 친화적 크기)
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await db.insert(regions).values(chunk).onConflictDoUpdate({
        target: regions.code,
        set: {
          level: drizzleSql`excluded.level`,
          name: drizzleSql`excluded.name`,
          parentCode: drizzleSql`excluded.parent_code`,
        },
      });
    }
  }

  const counts = await sql<{ level: string; n: number }[]>`
    SELECT level, count(*)::int AS n FROM regions GROUP BY level ORDER BY level
  `;
  console.log("최종 적재:", counts);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
