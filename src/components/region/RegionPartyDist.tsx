import type { RegionDistribution } from "@/lib/queries";

interface Props {
  dist: RegionDistribution;
}

export function RegionPartyDist({ dist }: Props) {
  if (dist.totalVotes === 0) {
    return (
      <section aria-labelledby="sec-dist" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-dist" className="text-sm font-semibold mb-2">
          {dist.raceKind === "candidate" ? "후보자별 득표" : "정당별 분포"}
        </h2>
        <p className="text-sm text-zinc-500">이 지역의 적재된 데이터가 없습니다.</p>
      </section>
    );
  }

  // 상위 8개 + justice 가 그 안에 없으면 명시 추가
  const ROW_LIMIT = 8;
  const top = dist.rows.slice(0, ROW_LIMIT);
  const justice = dist.rows.find((r) => r.partyId === "justice");
  const showJusticeCard = justice && justice.votes > 0;
  if (justice && !top.find((r) => r.partyId === "justice")) {
    top.push(justice);
  }
  const maxShare = Math.max(...top.map((r) => r.share));

  return (
    <section aria-labelledby="sec-dist" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 id="sec-dist" className="text-sm font-semibold">
          {dist.raceKind === "candidate" ? "후보자별 득표" : "정당별 분포"}
        </h2>
        <span className="text-xs text-zinc-500">총 {dist.totalVotes.toLocaleString()}표</span>
      </div>

      {/* 정의당 카드 — 비례·대선·광역단체장 race 에 한해, 후보자 race 면 partyId=justice 후보 1명에 해당 */}
      {showJusticeCard && (
        <div
          className="mb-4 rounded border-2 px-4 py-3"
          style={{ borderColor: justice!.color, backgroundColor: `${justice!.color}10` }}
        >
          <div className="text-xs text-zinc-500">{justice!.partyName}</div>
          <div className="text-2xl font-bold" style={{ color: justice!.color }}>
            {(justice!.share * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500">{justice!.votes.toLocaleString()}표</div>
        </div>
      )}

      {/* 정당/후보자 막대 리스트 */}
      <ul className="space-y-1.5">
        {top.map((row) => {
          const isJustice = row.partyId === "justice";
          const widthPct = maxShare > 0 ? (row.share / maxShare) * 100 : 0;
          return (
            <li key={row.partyId} className="flex items-center gap-2 text-sm">
              <span
                className={`shrink-0 w-32 truncate ${isJustice ? "font-semibold" : ""}`}
                title={row.partyName}
              >
                {row.partyName}
              </span>
              <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded relative overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${widthPct}%`, backgroundColor: row.color }}
                  aria-label={`${row.partyName} ${(row.share * 100).toFixed(1)}%`}
                />
              </div>
              <span className="shrink-0 w-14 text-right text-xs tabular-nums">
                {(row.share * 100).toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
