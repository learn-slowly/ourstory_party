import Link from "next/link";
import type { ChildrenTable } from "@/lib/region-types";
import { justiceShareColor } from "@/lib/region-share-color";

interface Props {
  table: ChildrenTable;
  electionId: string;
}

export function RegionChildrenTable({ table, electionId }: Props) {
  if (table.children.length === 0) {
    return (
      <section aria-labelledby="sec-children" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-children" className="text-sm font-semibold mb-2">하위 지역</h2>
        <p className="text-sm text-zinc-500">하위 지역이 없습니다.</p>
      </section>
    );
  }
  const q = `?election=${encodeURIComponent(electionId)}`;

  return (
    <section aria-labelledby="sec-children" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <h2 id="sec-children" className="text-sm font-semibold mb-2">
        하위 지역 ({table.children.length})
      </h2>
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="min-w-full text-xs tabular-nums">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left py-1.5 px-2 font-semibold">지역</th>
              {table.partyColumns.map((p) => (
                <th key={p.partyId} className="text-right py-1.5 px-2 font-semibold" style={{ color: p.color }}>
                  {p.partyName}
                </th>
              ))}
              <th className="text-right py-1.5 px-2 font-semibold text-zinc-500">합계</th>
            </tr>
          </thead>
          <tbody>
            {table.children.map((c) => {
              const justiceVotes = c.byParty["justice"] ?? 0;
              const justiceShare = c.total > 0 ? justiceVotes / c.total : 0;
              return (
                <tr key={c.code} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="text-left py-1 px-2">
                    <Link href={`/region/${encodeURIComponent(c.code)}${q}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  {table.partyColumns.map((p) => {
                    const votes = c.byParty[p.partyId] ?? 0;
                    const share = c.total > 0 ? votes / c.total : 0;
                    const bg = p.partyId === "justice" ? justiceShareColor(justiceShare) : undefined;
                    return (
                      <td
                        key={p.partyId}
                        className="text-right py-1 px-2"
                        style={bg ? { backgroundColor: bg } : undefined}
                      >
                        {(share * 100).toFixed(1)}%
                      </td>
                    );
                  })}
                  <td className="text-right py-1 px-2 text-zinc-500">{c.total.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
