export interface AliasRow {
  alias: string;
  party_id: string;
  valid_from: string | null;
  valid_until: string | null;
}

/**
 * NEC 원본 정당 표기를 우리 party_id 로 해석. 순수 함수.
 * onDate (YYYY-MM-DD) 시점 기준 valid 한 alias 만 매칭.
 * 매칭 안 되면 null.
 */
export function resolvePartyId(
  rawName: string,
  onDate: string,
  aliases: AliasRow[],
): string | null {
  const candidates = aliases.filter((r) => r.alias === rawName);
  for (const c of candidates) {
    const after = !c.valid_from || c.valid_from <= onDate;
    const before = !c.valid_until || onDate <= c.valid_until;
    if (after && before) return c.party_id;
  }
  return null;
}
