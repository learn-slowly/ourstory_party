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
});
