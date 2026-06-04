/**
 * 역사적 행정구역 코드 seed
 *
 * 법정동코드 파일에는 폐지 코드가 없어서 01-regions.ts 로 추가되지 않는,
 * 과거 선거 데이터에서 참조되는 코드들을 수동으로 추가한다.
 *
 * - 군위군 경상북도 시절 코드(4780000000):
 *   2023.7 대구광역시 편입 이전까지 경상북도 소속.
 *   2022 지선 등 과거 선거 NEC 데이터에서 경상북도|군위군 으로 출현.
 */
import { sql, db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";

const HISTORICAL: Array<{
  code: string;
  level: "sido" | "sigungu" | "emd";
  name: string;
  parentCode: string | null;
}> = [
  // 경상북도 군위군 (2023.7 대구 편입 전 코드)
  {
    code: "4780000000",
    level: "sigungu",
    name: "군위군",
    parentCode: "4700000000",
  },
];

async function main() {
  for (const r of HISTORICAL) {
    await db
      .insert(regions)
      .values(r)
      .onConflictDoUpdate({
        target: regions.code,
        set: { level: r.level, name: r.name, parentCode: r.parentCode },
      });
    console.log(`추가/갱신: ${r.code}(${r.name}) parent=${r.parentCode}`);
  }

  console.log(`총 ${HISTORICAL.length}건 역사적 지역 코드 완료`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
