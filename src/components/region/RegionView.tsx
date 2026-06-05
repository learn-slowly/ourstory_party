import type { regions as regionsTable } from "../../../db/schema";
import { Breadcrumb } from "./Breadcrumb";
import { ElectionPicker } from "./ElectionPicker";

type RegionRow = typeof regionsTable.$inferSelect;

interface RegionContext {
  region: RegionRow;
  ancestors: RegionRow[];
  children: RegionRow[];
  level: "sido" | "sigungu" | "emd";
}

interface ElectionLike {
  id: string;
  name: string;
}

interface Props {
  ctx: RegionContext;
  election: ElectionLike;
  electionOptions: ElectionLike[];
}

export function RegionView({ ctx, election, electionOptions }: Props) {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header>
        <Breadcrumb ancestors={ctx.ancestors} current={ctx.region} electionQuery={election.id} />
        <div className="flex flex-wrap items-baseline gap-3 mt-1">
          <h1 className="text-xl font-bold">
            {ctx.region.name}
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-700 dark:text-zinc-300">{election.name}</span>
          </h1>
          <ElectionPicker
            selectedId={election.id}
            options={electionOptions}
            regionCode={ctx.region.code}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          level: {ctx.level} · 하위 {ctx.children.length}건
        </p>
      </header>

      {/* 섹션 A — Phase 1.3.2 에서 구현 */}
      <section aria-labelledby="sec-dist" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-dist" className="text-sm font-semibold mb-2">정당별 분포</h2>
        <p className="text-sm text-zinc-500">Phase 1.3.2 에서 구현 (정당별 막대 + 정의당 카드).</p>
      </section>

      {/* 섹션 B — Phase 1.3.3 */}
      <section aria-labelledby="sec-children" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-children" className="text-sm font-semibold mb-2">하위 지역 표</h2>
        <p className="text-sm text-zinc-500">
          Phase 1.3.3 에서 구현 (children {ctx.children.length}건 × 정당 컬럼).
        </p>
      </section>

      {/* 섹션 C — Phase 1.3.4 (emd level 에서는 자체가 1개라 부적합 → 숨김) */}
      {ctx.level !== "emd" && (
        <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
          <h2 id="sec-presub" className="text-sm font-semibold mb-2">관내사전 vs 선거일</h2>
          <p className="text-sm text-zinc-500">Phase 1.3.4 에서 구현.</p>
        </section>
      )}

      {/* 섹션 D — Phase 1.3.5 */}
      <section aria-labelledby="sec-series" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-series" className="text-sm font-semibold mb-2">정의당 시계열</h2>
        <p className="text-sm text-zinc-500">Phase 1.3.5 에서 구현 (이 지역의 정의당 역대 추이).</p>
      </section>
    </div>
  );
}
