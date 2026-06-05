// scripts/build/lib/party-resolver.ts
import { readFileSync } from "node:fs";
import path from "node:path";

interface PartySeed {
  id: string;
  aliases: string[];
  activeFrom?: string;
  activeUntil?: string;
}
interface Override {
  electionId: string;
  rawName: string;
  partyId: string;
}

const PARTIES: PartySeed[] = JSON.parse(
  readFileSync(path.resolve("data/seed/parties.json"), "utf-8"),
);
const OVERRIDES: Override[] = JSON.parse(
  readFileSync(path.resolve("data/seed/election-party-overrides.json"), "utf-8"),
);

// alias 길이 내림차순 — prefix match 시 가장 긴 것 우선
const ALIASES: { alias: string; partyId: string }[] = PARTIES.flatMap((p) =>
  p.aliases.map((a) => ({ alias: a, partyId: p.id })),
).sort((a, b) => b.alias.length - a.alias.length);

export function resolveParty(rawName: string, electionDate: string, electionId?: string): string | null {
  // 1) override 우선
  if (electionId) {
    for (const o of OVERRIDES) {
      if (o.electionId === electionId && rawName.startsWith(o.rawName)) return o.partyId;
    }
  }
  // 2) prefix match (≥3자 alias)
  for (const a of ALIASES) {
    if (a.alias.length >= 3 && rawName.startsWith(a.alias)) return a.partyId;
  }
  // 3) exact match (단일 정당명 — 비례)
  for (const a of ALIASES) {
    if (rawName.trim() === a.alias) return a.partyId;
  }
  return null;
}
