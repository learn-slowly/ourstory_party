import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../src/lib/db-admin";
import { electionPartyOverrides, partyAliases } from "../../../db/schema";

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
  const override = await db
    .select()
    .from(electionPartyOverrides)
    .where(and(
      eq(electionPartyOverrides.electionId, electionId),
      eq(electionPartyOverrides.rawName, rawName),
    ))
    .limit(1);
  if (override.length) return override[0].partyId;

  const alias = await db
    .select()
    .from(partyAliases)
    .where(and(
      eq(partyAliases.alias, rawName),
      or(isNull(partyAliases.validFrom), lte(partyAliases.validFrom, electionDate)),
      or(isNull(partyAliases.validUntil), gte(partyAliases.validUntil, electionDate)),
    ))
    .limit(1);
  if (alias.length) return alias[0].partyId;

  return null;
}
