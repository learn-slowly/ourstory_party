"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props { data: ChartRow[]; lines: ChartLine[]; }

export function HomeChart({ data, lines }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[420px] flex items-center justify-center text-sm text-zinc-500">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis
          dataKey="electionLabel"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={70}
        />
        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name) => [`${value}%`, String(name)]}
          contentStyle={{ fontSize: 12 }}
        />
        {lines.map((l) => (
          <Line
            key={l.partyId}
            type="monotone"
            dataKey={l.partyId}
            name={l.name}
            stroke={l.color}
            strokeWidth={l.partyId === "justice" ? 3 : 2}
            dot={{ r: l.partyId === "justice" ? 4 : 3 }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
