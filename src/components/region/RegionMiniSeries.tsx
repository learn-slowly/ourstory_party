"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { SeriesPoint } from "@/lib/region-types";

interface Props {
  series: SeriesPoint[];
  regionName: string;
}

export function RegionMiniSeries({ series, regionName }: Props) {
  if (series.length === 0) {
    return (
      <section aria-labelledby="sec-series" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-series" className="text-sm font-semibold mb-2">정의당 시계열 — {regionName}</h2>
        <p className="text-sm text-zinc-500">이 지역의 정의당 역대 적재 데이터가 없습니다.</p>
      </section>
    );
  }

  const data = series.map((p) => ({
    name: p.election.name.replace(/제\s?\d+회\s*/g, "").trim(),
    pct: p.pct,
  }));
  const color = series[0]?.partyColor ?? "#FFCC00";

  return (
    <section aria-labelledby="sec-series" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 id="sec-series" className="text-sm font-semibold">정의당 시계열 — {regionName}</h2>
        <span className="text-xs text-zinc-500">{series.length}개 선거</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 60 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
          <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value) => [`${value}%`, "정의당 득표율"]}
            contentStyle={{ fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke={color}
            strokeWidth={3}
            dot={{ r: 3 }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
