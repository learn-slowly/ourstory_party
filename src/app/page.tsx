import { HomeView } from "../components/HomeView";
import { parseSearchParams } from "../lib/url-state";
import {
  getIndex,
  getRegionFile,
  getStationFile,
  listStationsOfEmd,
} from "../lib/static-data";
import { buildHomeChart, buildFilterOptions } from "../lib/static-series";

// 홈은 빌드 타임 SSG. URL searchParams 의존 분기는 클라이언트 라우터가 핸들 (Next.js 가 동적 segment 가 아닌 한 force-static 허용).
export const dynamic = "force-static";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// state.region 으로부터 cascading 에 필요한 sigungu/emd code 추출.
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

  const index = await getIndex();
  const filterOptions = buildFilterOptions({
    parties: index.parties,
    elections: index.elections,
    sido: index.regions.sido,
    sigunguByRegion: index.regions.sigunguByRegion,
  });

  // emd 옵션 — sigungu 가 잡혀있으면 index.regions.emdByRegion 에서 직접
  const emdOptions = ctx.sigunguCode
    ? (index.regions.emdByRegion?.[ctx.sigunguCode] ?? []).map((r) => ({ code: r.code, name: r.name }))
    : [];

  // station 옵션 — emd 가 잡혀있으면 그 emd 의 sigungu 이름 + emd 이름 으로 station 디렉토리 매칭.
  // sigungu/emd 의 한국어 name 은 region 파일 메타 로 해석.
  let stationOptions: { sigunguCode: string; emdCode: string; name: string }[] = [];
  if (ctx.emdCode && ctx.sigunguCode) {
    try {
      const emdFile = await getRegionFile(ctx.emdCode);
      const sigunguName = emdFile.parent?.name ?? "";
      const emdName = emdFile.name;
      if (sigunguName && emdName) {
        const stations = await listStationsOfEmd(sigunguName, emdName);
        stationOptions = stations.map((s) => ({
          sigunguCode: ctx.sigunguCode!,
          emdCode: ctx.emdCode!,
          name: s.name,
        }));
      }
    } catch {
      // 해당 emd 의 region 파일이 없으면 station 옵션 비움 — 정적 빌드 누락 케이스
    }
  }

  // 시계열 소스 — region/station 파일(들) 의 timeseries 모음
  const sources: { timeseries: Record<string, import("../types/static").TimeseriesPoint[]> }[] = [];
  if (state.region === "all") {
    // 전국 — 17 개 sido 파일 합산. 누락 파일은 silently skip.
    for (const s of index.regions.sido) {
      try {
        const f = await getRegionFile(s.code);
        sources.push({ timeseries: f.timeseries });
      } catch {
        // skip
      }
    }
  } else if (state.region.startsWith("station:")) {
    // "station:SIGUNGUCODE:EMDCODE:NAME" — sigungu/emd 의 한국어 name 으로 station 파일 키 합성
    const [, sigunguCode, emdCode, ...rest] = state.region.split(":");
    const stationName = rest.join(":");
    try {
      const emdFile = await getRegionFile(emdCode);
      const sigunguName = emdFile.parent?.name ?? "";
      const emdName = emdFile.name;
      if (sigunguName && emdName && stationName) {
        const stationKey = `${sigunguName}-${emdName}-${stationName}`;
        try {
          const f = await getStationFile(stationKey);
          sources.push({ timeseries: f.timeseries });
        } catch {
          // station 파일 누락 — 빈 시계열
        }
      }
    } catch {
      // emd 파일 누락 — 빈 시계열
    }
    void sigunguCode; // 코드 자체는 파일명 합성에 필요 없음 (이름이 키)
  } else {
    // sido/sigungu/emd 단일 region
    try {
      const f = await getRegionFile(state.region);
      sources.push({ timeseries: f.timeseries });
    } catch {
      // 해당 region 파일 없음 — 빈 시계열
    }
  }

  const { data, lines } = buildHomeChart({
    state,
    elections: index.elections,
    parties: index.parties,
    sources,
  });

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
