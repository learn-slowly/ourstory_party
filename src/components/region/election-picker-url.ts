// ElectionPicker 의 URL 생성 로직. 순수 함수로 분리해 client 컴포넌트 없이 단위 테스트.
// currentSearch 가 주어지면 그 안의 다른 쿼리 키(시계열 필터)를 보존하고 election 만 갱신.
export function buildRegionUrl(
  regionCode: string,
  electionId: string,
  currentSearch?: URLSearchParams | null,
): string {
  if (currentSearch) {
    // URLSearchParams 기반: 기존 쿼리 파라미터 유지, election 만 갱신
    const params = new URLSearchParams(currentSearch.toString());
    params.set("election", electionId);
    return `/region/${encodeURIComponent(regionCode)}?${params.toString()}`;
  }
  // 기존 시그니처 호환: electionId 의 encodeURIComponent 명시
  return `/region/${encodeURIComponent(regionCode)}?election=${encodeURIComponent(electionId)}`;
}
