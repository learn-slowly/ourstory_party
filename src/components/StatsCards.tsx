import type { ChartRow, ChartLine } from "../lib/series";

interface Props { data: ChartRow[]; lines: ChartLine[]; focusPartyId?: string; }

export function StatsCards({ data, lines, focusPartyId = "justice" }: Props) {
  const line = lines.find((l) => l.partyId === focusPartyId) ?? lines[0];
  if (!line) return null;
  const series = data
    .map((row) => ({ election: row.electionLabel as string, pct: row[line.partyId] }))
    .filter((p): p is { election: string; pct: number } => typeof p.pct === "number");

  if (series.length === 0) return null;

  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const delta = prev ? Math.round((last.pct - prev.pct) * 10) / 10 : null;
  const high = series.reduce((m, p) => (p.pct > m.pct ? p : m));
  const low = series.reduce((m, p) => (p.pct < m.pct ? p : m));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
      <Card
        title="직전 선거 대비"
        value={delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}%p`}
        sub={prev ? `${prev.election} → ${last.election}` : `${last.election}`}
        color={line.color}
      />
      <Card
        title={`${line.name} 고점`}
        value={`${high.pct}%`}
        sub={high.election}
        color={line.color}
      />
      <Card
        title={`${line.name} 저점`}
        value={`${low.pct}%`}
        sub={low.election}
        color={line.color}
      />
    </div>
  );
}

function Card({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3 bg-white dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}
