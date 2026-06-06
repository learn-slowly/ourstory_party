"use client";

// 시계열 표(엑셀형) 보기. HomeChart 와 동일한 data source (ChartRow/ChartLine) 사용.
// 행 = 선거(시간 순, 최신이 아래 — Excel 관습), 열 = 정당, 셀 = 득표율(%, 소수 1자리).
import type { ChartRow, ChartLine } from "../lib/series";

interface Props {
  data: ChartRow[];
  lines: ChartLine[];
}

export function HomeTable({ data, lines }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-zinc-500">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    );
  }
  return (
    <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded">
      <table className="min-w-full text-sm border-collapse">
        <thead className="bg-zinc-50 dark:bg-zinc-800">
          <tr>
            <th className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-left sticky left-0 bg-zinc-50 dark:bg-zinc-800 z-10 whitespace-nowrap">
              선거
            </th>
            {lines.map((l) => (
              <th
                key={l.partyId}
                className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-right whitespace-nowrap"
                style={{ borderTopColor: l.color, borderTopWidth: 3 }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-sm mr-1 align-middle"
                  style={{ backgroundColor: l.color }}
                  aria-hidden
                />
                {l.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.electionId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 sticky left-0 bg-white dark:bg-zinc-950 whitespace-nowrap">
                {r.electionLabel}
              </td>
              {lines.map((l) => {
                const val = r[l.partyId];
                const num = typeof val === "number" ? val : null;
                return (
                  <td
                    key={l.partyId}
                    className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-right tabular-nums"
                    style={l.partyId === "justice" ? { fontWeight: 600 } : undefined}
                  >
                    {num == null ? "—" : `${num.toFixed(1)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// CSV 다운로드 — UTF-8 BOM 으로 Excel 한글 정상 표시.
export function downloadCsv(data: ChartRow[], lines: ChartLine[], filename = "timeseries.csv") {
  const head = ["선거", ...lines.map((l) => l.name)];
  const body = data.map((r) => [
    r.electionLabel,
    ...lines.map((l) => {
      const v = r[l.partyId];
      return typeof v === "number" ? v.toFixed(1) : "";
    }),
  ]);
  const csv = [head, ...body]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
