import Link from "next/link";
import type { LiveSidoCell } from "../lib/queries";

interface Props {
  electionId: string;
  electionName: string;
  date: string;
  national: { progressPct: number | null; topParty: { name: string; color: string; pct: number } | null };
  cells: LiveSidoCell[];
  options: { id: string; name: string; date: string }[];
}

export function LiveBoard({ electionId, electionName, date, national, cells, options }: Props) {
  const isProvisional = national.progressPct != null && national.progressPct < 99.5;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">{electionName}</h1>
          <span className="text-sm text-zinc-500">{date}</span>
          {isProvisional && (
            <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              잠정 결과
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-zinc-500 self-center">선거 선택</span>
          {options.map((o) => (
            <Link
              key={o.id}
              href={`/live?election=${o.id}`}
              className={`px-2 py-1 rounded border ${
                o.id === electionId
                  ? "border-amber-500 text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30"
                  : "border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {o.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card
          title="전국 진행률"
          value={national.progressPct == null ? "—" : `${national.progressPct}%`}
          sub="시·도 평균"
        />
        <Card
          title="전국 1위"
          value={national.topParty?.name ?? "—"}
          sub={national.topParty ? `${national.topParty.pct}%` : "—"}
          color={national.topParty?.color}
        />
        <Card
          title="시·도 셀"
          value={`${cells.length}개`}
          sub="시·도별 진행률·1위 정당"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {cells.map((c) => (
          <div
            key={c.sidoCode}
            className="rounded border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-900"
          >
            <div className="text-xs text-zinc-500">{c.sidoName}</div>
            <div className="text-xs mt-1 text-zinc-600 dark:text-zinc-400">
              {c.progressPct == null ? "—" : `${c.progressPct}%`}
            </div>
            {c.topParty && (
              <div className="mt-1 text-sm font-bold" style={{ color: c.topParty.color }}>
                {c.topParty.name}{" "}
                <span className="font-normal text-xs text-zinc-500">{c.topParty.pct}%</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3 bg-white dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}
