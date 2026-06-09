import { notFound } from "next/navigation";
import {
  getIndex,
  getRegionFile,
  getElectionDetail,
  listAllRegionCodes,
} from "@/lib/static-data";
import {
  buildRegionContext,
  buildRegionDistribution,
  buildChildrenTable,
  buildPresubVsElDay,
  pickRegionElections,
} from "@/lib/static-region";
import { buildFilterOptions } from "@/lib/static-series";
import { parseSearchParams, normalizeRegionState } from "@/lib/url-state";
import { RegionView } from "@/components/region/RegionView";

export const dynamic = "force-static";
// searchParams 의존 분기(election 선택)는 클라이언트 라우터가 처리.
// 페이지 자체는 region.code 별로 1회 빌드 — picker 가 ?election=… 을 query 로 갱신해도 동일 페이지 재사용.
// 첫 렌더링에는 RegionFile.elections 중 최신 election 을 기본 선택으로 표시한다.
export const dynamicParams = false;

export async function generateStaticParams() {
  const codes = await listAllRegionCodes();
  return codes.map((code) => ({ code }));
}

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegionPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    flat[k] = Array.isArray(v) ? v[0] : v;
  }
  const initialState = normalizeRegionState(parseSearchParams(flat));

  if (!/^\d{10}$/.test(code)) notFound();

  const index = await getIndex();
  let regionFile;
  try {
    regionFile = await getRegionFile(code);
  } catch {
    notFound();
  }

  const ctx = buildRegionContext(regionFile, index);

  // election 옵션 — RegionFile 에 적재된 election 중 비재보궐
  const electionOptions = pickRegionElections(regionFile, index);
  if (electionOptions.length === 0) notFound();
  // 첫 렌더링은 최신 election (displayOrder desc 정렬의 head)
  const election = electionOptions[0];

  // 4 섹션 데이터 — 모두 정적 산출물에서 합성.
  // RegionPartyDist: RegionFile.elections summary 로 즉시 합성.
  const dist = buildRegionDistribution(regionFile, election.id, index.parties, index.elections);

  // RegionChildrenTable / PresubVsElDay: emd 레벨은 표시 안 함 (기존 동작 유지).
  let table = null;
  let presub = null;
  if (ctx.level !== "emd") {
    try {
      const detail = await getElectionDetail(code, election.id);
      table = buildChildrenTable(detail, index.parties, index, code);
      presub = buildPresubVsElDay(detail, index, code);
    } catch {
      // 해당 region × election 의 detail 파일 누락 — 섹션은 빈 상태로 노출
      table = { children: [], partyColumns: [] };
      presub = { hasData: false, rows: [] };
    }
  }

  const filterOptions = buildFilterOptions({
    parties: index.parties,
    elections: index.elections,
    sido: index.regions.sido,
    sigunguByRegion: index.regions.sigunguByRegion,
  });

  return (
    <RegionView
      ctx={ctx}
      election={{ id: election.id, name: election.name }}
      electionOptions={electionOptions.map((e) => ({ id: e.id, name: e.name }))}
      dist={dist}
      table={table}
      presub={presub}
      regionCode={code}
      regionName={regionFile.name}
      regionFile={regionFile}
      index={index}
      timeseries={regionFile.timeseries}
      initialState={initialState}
      filterOptions={filterOptions}
      elections={index.elections}
      parties={index.parties}
    />
  );
}
