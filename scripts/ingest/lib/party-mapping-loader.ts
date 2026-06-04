import { sql } from "../../../src/lib/db-admin";
import type { AliasRow } from "./party-mapping";

/** Supabase 에서 alias 전체 로드. 인제스천 스크립트가 1회 호출 후 resolvePartyId 에 전달. */
export async function loadAliases(): Promise<AliasRow[]> {
  return await sql<AliasRow[]>`
    SELECT alias, party_id, valid_from, valid_until FROM party_aliases
  `;
}
