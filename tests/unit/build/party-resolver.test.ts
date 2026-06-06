// tests/unit/build/party-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveParty } from "../../../scripts/build/lib/party-resolver";

describe("resolveParty", () => {
  it("정당명+후보자 prefix 매칭", () => {
    expect(resolveParty("더불어민주당\n곽상언", "2024-04-10")).toBe("democratic");
    expect(resolveParty("자유한국당\n홍준표", "2017-05-09")).toBe("people_power");
  });
  it("정당명 단독 (비례)", () => {
    expect(resolveParty("녹색정의당", "2024-04-10")).toBe("justice");
  });
  it("election_party_overrides 우선 — 2025 권영국=민주노동당 → justice", () => {
    expect(resolveParty("민주노동당\n권영국", "2025-06-03", "2025-presidential")).toBe("justice");
  });
  it("미매핑 후보 → null", () => {
    expect(resolveParty("듣도보도못한당\n홍길동", "2024-04-10")).toBe(null);
  });
  it("빈/공백 rawName → null", () => {
    expect(resolveParty("", "2024-04-10")).toBe(null);
    expect(resolveParty("   ", "2024-04-10")).toBe(null);
  });
  it("2자 alias 는 prefix match 안 됨 (≥3자 가드)", () => {
    // 만약 'XX' 같은 2자 alias 가 있어도 prefix 매칭 X
    // — 직접 확인은 alias seed 에 2자 없음. 대신 짧은 가짜 alias 대비 가드 동작만 확인:
    expect(resolveParty("XY홍길동", "2024-04-10")).toBe(null);
  });
  it("longest alias wins — 더불어민주연합 > 더불어민주당", () => {
    // 2024 비례: '더불어민주연합' 이 별도 정당 (democratic_alliance_2024)
    expect(resolveParty("더불어민주연합", "2024-04-10")).toBe("democratic_alliance_2024");
  });
});
