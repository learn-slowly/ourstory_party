// scripts/build/lib/build-station.ts
import { ParsedElection } from "./types";
import { resolveParty } from "./party-resolver";
import { StationFile } from "../../../src/types/static";

export function buildStations(parsedAll: Map<string, ParsedElection>): Map<string, StationFile> {
  const stations = new Map<string, StationFile>();
  for (const [, parsed] of parsedAll) {
    for (const r of parsed.rows) {
      if (r.kind !== "el_day" || !r.stationName) continue;
      const key = `${r.sigunguName}-${r.emdName ?? "x"}-${r.stationName}`;
      if (!stations.has(key)) {
        stations.set(key, {
          stationKey: key,
          name: r.stationName,
          emdName: r.emdName ?? "",
          sigunguName: r.sigunguName,
          sidoName: r.sidoName,
          timeseries: {},
        });
      }
      const f = stations.get(key)!;
      for (const p of r.parties) {
        const pid = resolveParty(p.rawName, parsed.electionDate, parsed.electionId);
        if (!pid) continue;
        if (!f.timeseries[pid]) f.timeseries[pid] = [];
        f.timeseries[pid].push({
          electionId: parsed.electionId,
          votes: p.votes,
          totalVotes: r.validVotes,
          share: r.validVotes ? +(p.votes / r.validVotes * 100).toFixed(2) : 0,
        });
      }
    }
  }
  return stations;
}
