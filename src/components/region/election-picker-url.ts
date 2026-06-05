// ElectionPicker 의 URL 생성 로직. 순수 함수로 분리해 client 컴포넌트 없이 단위 테스트.
export function buildRegionUrl(regionCode: string, electionId: string): string {
  return `/region/${encodeURIComponent(regionCode)}?election=${encodeURIComponent(electionId)}`;
}
