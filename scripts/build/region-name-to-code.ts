// scripts/build/region-name-to-code.ts
// NEC xlsx 의 (시·도, 시·군·구, 읍·면·동) 이름을 region code 로 매핑
import type { StaticIndex } from "../../src/types/static";

export interface RegionNameLookup {
  sido: Record<string, string>;                              // name → code
  sigunguByParent: Record<string, Record<string, string>>;   // sidoCode → name → code
  emdByParent: Record<string, Record<string, string>>;       // sigunguCode → name → code
}

const norm = (s: string) => s.trim();

export function buildRegionNameLookup(index: StaticIndex): RegionNameLookup {
  const sido: Record<string, string> = {};
  for (const r of index.regions.sido) sido[norm(r.name)] = r.code;

  const sigunguByParent: Record<string, Record<string, string>> = {};
  for (const [sidoCode, list] of Object.entries(index.regions.sigunguByRegion)) {
    const m: Record<string, string> = {};
    for (const r of list) m[norm(r.name)] = r.code;
    sigunguByParent[sidoCode] = m;
  }

  const emdByParent: Record<string, Record<string, string>> = {};
  for (const [sigunguCode, list] of Object.entries(index.regions.emdByRegion ?? {})) {
    const m: Record<string, string> = {};
    for (const r of list) m[norm(r.name)] = r.code;
    emdByParent[sigunguCode] = m;
  }

  return { sido, sigunguByParent, emdByParent };
}

export function lookupRegion(
  l: RegionNameLookup,
  path: { sido?: string; sigungu?: string; emd?: string },
): string | null {
  const sidoName = path.sido ? norm(path.sido) : "";
  if (!sidoName) return null;
  const sidoCode = l.sido[sidoName];
  if (!sidoCode) return null;
  if (!path.sigungu) return sidoCode;

  const sigunguName = norm(path.sigungu);
  const sigunguCode = l.sigunguByParent[sidoCode]?.[sigunguName];
  if (!sigunguCode) return null;
  if (!path.emd) return sigunguCode;

  const emdName = norm(path.emd);
  const emdCode = l.emdByParent[sigunguCode]?.[emdName];
  return emdCode ?? null;
}
