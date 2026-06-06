// scripts/build/lib/parse-format-e.ts
// 형식 E — archive HTML 폴백 (NEC 다운로드 xlsx 미수신 election 용, 예: 2007 대선·2008 총선)
import { readFile } from "node:fs/promises";
import { parseVccp08Stations } from "./nec-html";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

// nec-html.ts 의 kind ("station" / "el_day" / "presub" / "abs" / "absentee" / "overseas" / "misc") →
// ParsedStationRow.RowKind 으로 매핑. "station" 은 el_day 로 정규화.
const KIND_MAP: Record<string, RowKind> = {
  station: "el_day",
  el_day: "el_day",
  presub: "presub",
  abs: "abs",
  absentee: "absentee",
  overseas: "overseas",
  misc: "misc",
};

interface OptsE {
  sidoName: string;
  sigunguName: string;
}

export async function parseFormatE(htmlPath: string, opts: OptsE): Promise<ParsedElection> {
  const html = await readFile(htmlPath, "utf-8");
  const result = parseVccp08Stations(html);
  if (result.kind === "no-data") {
    return { electionId: "", electionDate: "", rows: [], partyNames: [] };
  }

  const rows: ParsedStationRow[] = result.rows.map((r) => ({
    sidoName: opts.sidoName,
    sigunguName: opts.sigunguName,
    emdName: r.emdName,
    stationName: r.kind === "station" || r.kind === "el_day" ? r.name : null,
    kind: KIND_MAP[r.kind] ?? "misc",
    totalVoters: r.totalVoters,
    totalVotes: r.totalVotes,
    validVotes: r.validVotes,
    invalidVotes: r.invalidVotes,
    parties: r.parties.map((p) => ({ rawName: p.name, votes: p.votes })),
  }));
  return { electionId: "", electionDate: "", rows, partyNames: result.partyNames };
}
