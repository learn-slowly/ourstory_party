"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props { data: ChartRow[]; lines: ChartLine[]; }

export function HomeChart({ data, lines }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[460px] flex items-center justify-center text-sm text-zinc-500">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    );
  }
  return (
    // 총 높이 460 = Legend(상단 32) + Chart + X축 라벨(120, -30° 회전 + 긴 선거명 수용)
    <ResponsiveContainer width="100%" height={460}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
        <Legend
          verticalAlign="top"
          align="right"
          height={32}
          iconSize={10}
          wrapperStyle={{ fontSize: 12, paddingBottom: 4 }}
        />
        <XAxis
          dataKey="electionLabel"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={120}
        />
        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name) =>
            typeof value === "number"
              ? [`${value}%`, String(name)]
              : ["미출마", String(name)]
          }
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
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
