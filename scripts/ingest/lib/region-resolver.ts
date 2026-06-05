// NEC cityCode/townCode → ourstory regions.code 매핑.
// CITY_CODES.name 으로 시·도 이름 확보, fetchTownCodes 로 시·군·구 이름 확보,
// 그 이름들을 DB 의 regions.name 과 매칭 (기존 process.ts 의 regionCodeOf 동일 로직).

import { sql as drizzleSql } from "drizzle-orm";
import { db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";
import { CITY_CODES, fetchTownCodes } from "./nec-codes";

// process.ts 와 동일한 alias 셋
const SIDO_NAME_ALIASES: Record<string, string> = {
  "강원도": "강원특별자치도",
  "전라북도": "전북특별자치도",
};

type RegionRow = {
  code: string;
  level: "sido" | "sigungu" | "emd";
  name: string;
  parentCode: string | null;
};

export interface RegionResolver {
  /** NEC cityCode → sido regions.code */
  sidoCode(necCityCode: string): string | null;
  /** NEC cityCode + NEC townCode → sigungu regions.code */
  sigunguCode(necCityCode: string, necTownCode: string): Promise<string | null>;
  /** sigungu regions.code + emdName → emd regions.code */
  emdCode(sigunguCode: string, emdName: string): string | null;
}

export async function createRegionResolver(): Promise<RegionResolver> {
  // 전 regions 로드 (수천 행, 한 번에 메모리 OK)
  const all = (await db
    .select({
      code: regions.code,
      level: regions.level,
      name: regions.name,
      parentCode: regions.parentCode,
    })
    .from(regions)) as RegionRow[];

  // 시·도 이름 → sido row
  const sidoByName = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "sido") continue;
    sidoByName.set(r.name, r);
  }
  // alias 역방향도 등록 (강원도 → 강원특별자치도 record)
  for (const [oldName, newName] of Object.entries(SIDO_NAME_ALIASES)) {
    if (!sidoByName.has(oldName) && sidoByName.has(newName)) {
      sidoByName.set(oldName, sidoByName.get(newName)!);
    }
  }

  // NEC cityCode → sido name → regions.code
  const cityCodeToSidoCode = new Map<string, string>();
  for (const c of CITY_CODES) {
    const s = sidoByName.get(c.name);
    if (s) cityCodeToSidoCode.set(c.code, s.code);
  }

  // 빠른 조회를 위해 code → RegionRow 맵
  const byCode = new Map<string, RegionRow>();
  for (const r of all) byCode.set(r.code, r);

  // "{sidoName}|{sigunguName}" → sigungu row
  const sigunguByKey = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "sigungu") continue;
    const parent = r.parentCode ? byCode.get(r.parentCode) : undefined;
    sigunguByKey.set(`${parent?.name ?? ""}|${r.name}`, r);
  }

  // sigunguCode + emdName → emd
  const emdByKey = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "emd") continue;
    emdByKey.set(`${r.parentCode ?? ""}|${r.name}`, r);
  }

  // sigungu prefix (4자리) + emdName → emd. 화성시 같이 시 본체(4159000000) 가
  // 직접 emd child 를 안 갖고 sub-sigungu(4159300000 등) 아래 emd 가 붙는 경우 fallback.
  // 같은 prefix 안에서 emd 이름 중복 가능 — 첫 매칭 사용 (실용상 안전)
  const emdByPrefixKey = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "emd") continue;
    const prefix = r.code.slice(0, 4);
    const key = `${prefix}|${r.name}`;
    if (!emdByPrefixKey.has(key)) emdByPrefixKey.set(key, r);
  }

  // NEC townCode 이름 캐시 — cityCode → (townCode → name)
  // 시·도 단위 처음 호출 시 fetchTownCodes 한 번으로 전체 townCode 이름 일괄 수집
  const townNameCache = new Map<string, Map<string, string>>();

  async function ensureTownNames(cityCode: string): Promise<void> {
    if (townNameCache.has(cityCode)) return;
    const towns = await fetchTownCodes("0020250603", cityCode); // 임의 활성 electionId
    const map = new Map<string, string>();
    for (const t of towns) map.set(t.code, t.name);
    townNameCache.set(cityCode, map);
  }

  function resolveSigungu(sdName: string, wiwName: string): string | null {
    // 정확 매칭
    const exact = sigunguByKey.get(`${sdName}|${wiwName}`);
    if (exact) return exact.code;

    // parent null fallback — 세종특별자치시처럼 시·도 = sigungu 인 자치시.
    // ourstory regions seed 가 세종 sigungu parent 를 null 로 저장하는 경우 매칭.
    if (sdName === wiwName) {
      const parentNull = sigunguByKey.get(`|${wiwName}`);
      if (parentNull) return parentNull.code;
    }

    // 부분 매칭 (창원시의창구 → DB 의 의창구 등)
    const sidoRow = sidoByName.get(sdName);
    if (sidoRow) {
      for (const r of all) {
        if (r.level !== "sigungu") continue;
        if (r.parentCode !== sidoRow.code) continue;
        // wiwName 이 DB name 으로 끝나면 매칭 (예: "창원시의창구" ends with "의창구")
        if (r.name && wiwName.endsWith(r.name)) return r.code;
      }
    }

    // 갑·을·병·정 제거 매칭 (국회의원 선거구 등)
    const stripped = wiwName.replace(/[갑을병정]$/, "");
    if (stripped !== wiwName) {
      const strippedExact = sigunguByKey.get(`${sdName}|${stripped}`);
      if (strippedExact) return strippedExact.code;
    }

    return null;
  }

  return {
    sidoCode(necCityCode: string): string | null {
      return cityCodeToSidoCode.get(necCityCode) ?? null;
    },

    async sigunguCode(necCityCode: string, necTownCode: string): Promise<string | null> {
      await ensureTownNames(necCityCode);
      const wiwName = townNameCache.get(necCityCode)?.get(necTownCode);
      if (!wiwName) return null;
      const cityRow = CITY_CODES.find((c) => c.code === necCityCode);
      if (!cityRow) return null;
      return resolveSigungu(cityRow.name, wiwName);
    },

    emdCode(sigunguCode: string, emdName: string): string | null {
      // 1차: 직접 child emd lookup
      const direct = emdByKey.get(`${sigunguCode}|${emdName}`)?.code;
      if (direct) return direct;
      // 2차: sigungu prefix(4자리) 안 모든 emd 탐색 — 시 본체에 emd 가 없고
      //      sub-sigungu(일반구) 아래 붙은 경우 (예: 화성시·청주시·고양시 등)
      const prefix = sigunguCode.slice(0, 4);
      return emdByPrefixKey.get(`${prefix}|${emdName}`)?.code ?? null;
    },
  };
}

// drizzleSql 사용 자리(향후 raw SQL 매칭 필요 시) 보존
void drizzleSql;
