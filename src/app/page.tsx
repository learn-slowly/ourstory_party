import { HomeView } from "../components/HomeView";
import { parseSearchParams } from "../lib/url-state";
import {
  getTimeseries,
  getFilterOptions,
  getEmdsOfSigungu,
  getStationsOfEmd,
} from "../lib/queries";
import { toRechartsData } from "../lib/series";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// state.region 으로부터 cascading 에 필요한 sigungu/emd code 추출.
// 픽커는 항상 부모 옵션 목록을 노출해야 하므로 (예: emd 선택 상태에서도 그 emd의 형제 emds 가 picker 에 보여야 함)
// 현재 state.region 의 부모 chain 을 거슬러 sigungu·emd 컨텍스트를 잡는다.
function deriveContext(rcode: string): { sigunguCode: string | null; emdCode: string | null } {
  if (rcode === "all" || !rcode) return { sigunguCode: null, emdCode: null };
  if (rcode.startsWith("station:")) {
    const [, sigungu, emd] = rcode.split(":");
    return { sigunguCode: sigungu ?? null, emdCode: emd ?? null };
  }
  if (rcode.startsWith("9")) {
    // synthetic admin emd — parent sigungu = chars[1:6] + "00000"
    return { sigunguCode: rcode.slice(1, 6) + "00000", emdCode: rcode };
  }
  if (!/^\d{10}$/.test(rcode)) return { sigunguCode: null, emdCode: null };
  if (rcode.endsWith("00000000")) return { sigunguCode: null, emdCode: null }; // sido
  if (rcode.endsWith("00000")) return { sigunguCode: rcode, emdCode: null }; // sigungu
  if (rcode.endsWith("00")) {
    // legal emd: parent sigungu = first 5 + "00000"
    return { sigunguCode: rcode.slice(0, 5) + "00000", emdCode: rcode };
  }
  return { sigunguCode: null, emdCode: null };
}

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    flat[k] = Array.isArray(v) ? v[0] : v;
  }
  const state = parseSearchParams(flat);
  const ctx = deriveContext(state.region);

  const [series, filterOptions, emdOptions, stationOptions] = await Promise.all([
    getTimeseries(state),
    getFilterOptions(),
    ctx.sigunguCode ? getEmdsOfSigungu(ctx.sigunguCode) : Promise.resolve([]),
    ctx.emdCode ? getStationsOfEmd(ctx.emdCode) : Promise.resolve([]),
  ]);
  const { data, lines } = toRechartsData(series);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold mb-1">진보계열 정당 역대 선거 시계열</h1>
      <p className="text-sm text-zinc-500 mb-4">필터를 바꾸면 URL 이 함께 갱신됩니다 (공유 가능).</p>
      <HomeView
        state={state}
        filterOptions={filterOptions}
        emdOptions={emdOptions}
        stationOptions={stationOptions}
        data={data}
        lines={lines}
      />
    </main>
  );
}
