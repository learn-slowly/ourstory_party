import type { SeriesPoint } from "./queries";

export interface ChartLine {
  partyId: string;
  name: string;
  color: string;
  family: string;
}

export interface ChartRow {
  electionId: string;
  electionLabel: string;
  date: string;
  displayOrder: number;
  [partyId: string]: number | string;
}

export function toRechartsData(points: SeriesPoint[]): { data: ChartRow[]; lines: ChartLine[] } {
  const rowsByElection = new Map<string, ChartRow>();
  const lineByParty = new Map<string, ChartLine>();

  for (const p of points) {
    const eid = p.election.id;
    let row = rowsByElection.get(eid);
    if (!row) {
      row = {
        electionId: eid,
        electionLabel: p.election.name,
        date: p.election.date,
        displayOrder: p.election.displayOrder ?? 0,
      };
      rowsByElection.set(eid, row);
    }
    if (p.pct != null) row[p.partyId] = p.pct;

    if (!lineByParty.has(p.partyId)) {
      lineByParty.set(p.partyId, {
        partyId: p.partyId,
        name: p.partyName,
        color: p.partyColor,
        family: p.partyFamily,
      });
    }
  }

  const data = [...rowsByElection.values()].sort((a, b) => a.displayOrder - b.displayOrder);
  const linesArr = [...lineByParty.values()];
  linesArr.sort((a, b) => {
    if (a.partyId === "justice") return -1;
    if (b.partyId === "justice") return 1;
    return 0;
  });
  return { data, lines: linesArr };
}
