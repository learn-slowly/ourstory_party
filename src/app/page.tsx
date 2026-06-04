import { HomeView } from "../components/HomeView";
import { parseSearchParams } from "../lib/url-state";
import { getTimeseries, getFilterOptions } from "../lib/queries";
import { toRechartsData } from "../lib/series";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    flat[k] = Array.isArray(v) ? v[0] : v;
  }
  const state = parseSearchParams(flat);
  const [series, filterOptions] = await Promise.all([
    getTimeseries(state),
    getFilterOptions(),
  ]);
  const { data, lines } = toRechartsData(series);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold mb-1">진보계열 정당 역대 선거 시계열</h1>
      <p className="text-sm text-zinc-500 mb-4">필터를 바꾸면 URL 이 함께 갱신됩니다 (공유 가능).</p>
      <HomeView state={state} filterOptions={filterOptions} data={data} lines={lines} />
    </main>
  );
}
