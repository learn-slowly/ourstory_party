import type { PresubElDayResult } from "@/lib/queries";

interface Props {
  presub: PresubElDayResult;
}

export function PresubVsElDay({ presub }: Props) {
  if (!presub.hasData) {
    return (
      <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-presub" className="text-sm font-semibold mb-2">관내사전 vs 선거일</h2>
        <p className="text-sm text-zinc-500">
          이 선거는 NEC archive 가 emd-level 분해 데이터를 미공개합니다.
        </p>
      </section>
    );
  }

  // 정의당 rows 만 추림 → emd 별 (사전, 선거일) 두 막대
  const justiceRows = presub.rows.filter((r) => r.partyId === "justice");
  if (justiceRows.length === 0) {
    return (
      <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-presub" className="text-sm font-semibold mb-2">관내사전 vs 선거일 — 정의당</h2>
        <p className="text-sm text-zinc-500">정의당 데이터가 없습니다.</p>
      </section>
    );
  }

  // emd 별 sub + el_day 합 기준으로 share 계산 (이 emd 안 정의당이 사전과 선거일에서 어느 비율)
  const enriched = justiceRows.map((r) => {
    const total = r.presub + r.elDay;
    return {
      regionCode: r.regionCode,
      regionName: r.regionName,
      presub: r.presub,
      elDay: r.elDay,
      presubPct: total > 0 ? r.presub / total : 0,
      elDayPct: total > 0 ? r.elDay / total : 0,
      total,
    };
  }).filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20); // 상위 20개 표시

  return (
    <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 id="sec-presub" className="text-sm font-semibold">관내사전 vs 선거일 — 정의당</h2>
        <span className="text-xs text-zinc-500">상위 {enriched.length}개 emd</span>
      </div>
      <ul className="space-y-1 text-xs max-h-96 overflow-y-auto">
        {enriched.map((r) => (
          <li key={r.regionCode} className="flex items-center gap-2">
            <span className="shrink-0 w-24 truncate" title={r.regionName}>{r.regionName}</span>
            <div className="flex-1 flex h-4 rounded overflow-hidden bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full"
                style={{ width: `${r.presubPct * 100}%`, backgroundColor: "#FFCC00" }}
                title={`사전 ${r.presub.toLocaleString()}표 (${(r.presubPct * 100).toFixed(1)}%)`}
              />
              <div
                className="h-full"
                style={{ width: `${r.elDayPct * 100}%`, backgroundColor: "#B89600" }}
                title={`선거일 ${r.elDay.toLocaleString()}표 (${(r.elDayPct * 100).toFixed(1)}%)`}
              />
            </div>
            <span className="shrink-0 w-20 text-right tabular-nums text-zinc-500">{r.total.toLocaleString()}표</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">
        <span className="inline-block w-3 h-3 align-middle mr-1" style={{ backgroundColor: "#FFCC00" }}></span>관내사전
        <span className="inline-block w-3 h-3 align-middle ml-3 mr-1" style={{ backgroundColor: "#B89600" }}></span>선거일
      </p>
    </section>
  );
}
