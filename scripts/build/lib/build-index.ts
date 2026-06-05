// scripts/build/lib/build-index.ts
// data/seed/{elections,parties,regions}.json → StaticIndex 변환.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { StaticIndex } from "../../../src/types/static";

// hasStationLevel — NEC archive 에서 station-level (투표소) 데이터가 가용한 선거 타입.
// 대선·총선(지역구/비례)·재보궐은 true. 지선(governor/mayor/local_council/local_council_prop/local_council_basic/superintendent 등)은 false.
const STATION_TYPES = new Set([
  "presidential",
  "general",
  "general_prop",
  "byelection",
]);

interface SeedElection {
  id: string;
  name: string;
  date: string;
  type: string;
  isByelection?: boolean;
  displayOrder?: number;
}

interface SeedParty {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string | null;
}

export function buildIndex(): StaticIndex {
  const elections: SeedElection[] = JSON.parse(
    readFileSync(path.resolve("data/seed/elections.json"), "utf-8"),
  );
  const parties: SeedParty[] = JSON.parse(
    readFileSync(path.resolve("data/seed/parties.json"), "utf-8"),
  );
  const regions = JSON.parse(
    readFileSync(path.resolve("data/seed/regions.json"), "utf-8"),
  );

  return {
    version: "2026-06-06",
    elections: elections.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date,
      type: e.type,
      isByelection: e.isByelection ?? false,
      hasStationLevel: STATION_TYPES.has(e.type),
      displayOrder: e.displayOrder ?? 0,
    })),
    parties: parties.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      family: p.family,
      satelliteOf: p.satelliteOf ?? null,
    })),
    regions: {
      sido: regions.sido,
      sigunguByRegion: regions.sigunguByRegion,
      emdByRegion: regions.emdByRegion,
    },
  };
}
