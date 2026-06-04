import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../src/lib/db-admin";
import { electionPartyOverrides, partyAliases } from "../../../db/schema";

// ── 인메모리 캐시 ─────────────────────────────────────────────
// election별 override 맵: `${electionId}|${rawName}` → partyId
const overrideCache = new Map<string, string>();
// alias 날짜별 캐시: `${electionDate}|${rawName}` → partyId | null
const aliasCache = new Map<string, string | null>();
// 캐시 로드 여부 추적
const overridesLoaded = new Set<string>();  // electionId
const aliasesLoaded = new Set<string>();    // electionDate

/**
 * 인메모리 캐시를 초기화한다.
 * 테스트에서 각 테스트 케이스 간 캐시 오염을 방지하기 위해 사용.
 */
export function clearPartyResolverCache(): void {
  overrideCache.clear();
  aliasCache.clear();
  overridesLoaded.clear();
  aliasesLoaded.clear();
}

/**
 * 해당 electionId의 overrides를 한 번에 로드해 캐시에 저장.
 */
async function loadOverrides(electionId: string): Promise<void> {
  if (overridesLoaded.has(electionId)) return;
  const rows = await db
    .select()
    .from(electionPartyOverrides)
    .where(eq(electionPartyOverrides.electionId, electionId));
  for (const r of rows) {
    overrideCache.set(`${electionId}|${r.rawName}`, r.partyId);
  }
  overridesLoaded.add(electionId);
}

/**
 * 해당 electionDate에 유효한 aliases를 한 번에 로드해 캐시에 저장.
 */
async function loadAliases(electionDate: string): Promise<void> {
  if (aliasesLoaded.has(electionDate)) return;
  const rows = await db
    .select()
    .from(partyAliases)
    .where(
      and(
        or(isNull(partyAliases.validFrom), lte(partyAliases.validFrom, electionDate)),
        or(isNull(partyAliases.validUntil), gte(partyAliases.validUntil, electionDate)),
      ),
    );
  for (const r of rows) {
    const key = `${electionDate}|${r.alias}`;
    // 이미 등록된 경우 덮어쓰지 않음 (첫 번째 우선)
    if (!aliasCache.has(key)) {
      aliasCache.set(key, r.partyId);
    }
  }
  aliasesLoaded.add(electionDate);
}

/**
 * 우선순위: election_party_overrides → party_aliases(시기 매칭) → null
 *
 * @param electionId - elections.id (예: "2025-presidential")
 * @param electionDate - YYYY-MM-DD (alias validFrom/validUntil 비교용)
 * @param rawName - data.go.kr 응답의 jdName 등 원문 정당명
 * @returns parties.id 또는 null (매칭 실패 — 호출자가 R3 경고 누적)
 */
export async function resolveParty(
  electionId: string,
  electionDate: string,
  rawName: string,
): Promise<string | null> {
  // 첫 호출 시 해당 election의 overrides와 aliases를 일괄 로드
  await loadOverrides(electionId);
  await loadAliases(electionDate);

  const overrideKey = `${electionId}|${rawName}`;
  if (overrideCache.has(overrideKey)) return overrideCache.get(overrideKey)!;

  const aliasKey = `${electionDate}|${rawName}`;
  if (aliasCache.has(aliasKey)) return aliasCache.get(aliasKey) ?? null;

  return null;
}
