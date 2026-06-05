/**
 * 정의당 share(0~1) → CSS background-color 문자열.
 * 0% 부근 → 매우 옅은 정의당 색, 10% 이상 → 진한 정의당 색.
 * 임계값 10% 이상이면 max 색, 0~10% 사이는 알파 채널 그라데이션.
 */
export function justiceShareColor(share: number): string {
  const clamped = Math.max(0, Math.min(0.1, share));
  const alpha = clamped / 0.1; // 0..1
  // 정의당 색 = #FFCC00. RGB(255, 204, 0). 알파 합성.
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#FFCC00${a}`;
}
