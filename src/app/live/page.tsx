import { LiveBoard } from "../../components/LiveBoard";
import { getLiveSnapshot, getLiveElectionOptions } from "../../lib/queries";

export const revalidate = 30;

// 2026 데이터 공개 후 자동 동작. 미공개 시 가장 최근 적재된 election으로 fallback.
const DEFAULT_LIVE_ID = "2026-local-governor";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Live({ searchParams }: PageProps) {
  const sp = await searchParams;
  const options = await getLiveElectionOptions();
  const requested = (Array.isArray(sp.election) ? sp.election[0] : sp.election) ?? DEFAULT_LIVE_ID;

  // requested 가 아직 적재 안 된 경우 (예: 2026 INFO-03) → 가장 최근 적재된 election으로 fallback
  const validIds = new Set(options.map((o) => o.id));
  const electionId = validIds.has(requested) ? requested : (options[0]?.id ?? DEFAULT_LIVE_ID);

  let snap: Awaited<ReturnType<typeof getLiveSnapshot>>;
  try {
    snap = await getLiveSnapshot(electionId);
  } catch {
    return (
      <main className="max-w-5xl mx-auto px-4 py-6">
        <p className="text-sm text-zinc-500">선거를 찾을 수 없습니다: {electionId}</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <LiveBoard
        electionId={electionId}
        electionName={snap.electionName}
        date={snap.date}
        national={snap.national}
        cells={snap.cells}
        options={options}
      />
    </main>
  );
}
