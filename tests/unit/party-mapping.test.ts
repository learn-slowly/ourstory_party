import { describe, it, expect } from "vitest";
import { resolvePartyId, type AliasRow } from "../../scripts/ingest/lib/party-mapping";

// 픽스처 — DB 호출 없이 순수 로직 검증
const ALIASES: AliasRow[] = [
  { alias: "정의당", party_id: "justice", valid_from: "2012-10-22", valid_until: null },
  { alias: "녹색정의당", party_id: "justice", valid_from: "2024-02-12", valid_until: "2024-06-08" },
  { alias: "더불어민주당", party_id: "democratic", valid_from: "2014-03-26", valid_until: null },
  { alias: "더불어민주연합", party_id: "democratic_alliance_2024", valid_from: "2024-03-03", valid_until: null },
  { alias: "국민의미래", party_id: "people_future_2024", valid_from: "2024-02-13", valid_until: null },
  { alias: "새누리당", party_id: "people_power", valid_from: "2012-02-13", valid_until: "2017-02-13" },
  { alias: "국민의힘", party_id: "people_power", valid_from: "2020-09-02", valid_until: null },
  { alias: "민주노동당", party_id: "minlabour", valid_from: "2000-01-30", valid_until: "2011-12-05" },
];

describe("party-mapping", () => {
  it("정확 매칭", () => {
    expect(resolvePartyId("정의당", "2024-04-10", ALIASES)).toBe("justice");
    expect(resolvePartyId("녹색정의당", "2024-04-10", ALIASES)).toBe("justice");
    expect(resolvePartyId("더불어민주당", "2024-04-10", ALIASES)).toBe("democratic");
  });

  it("위성정당 본당 매핑 안 함 (각자 ID 유지)", () => {
    expect(resolvePartyId("더불어민주연합", "2024-04-10", ALIASES)).toBe("democratic_alliance_2024");
    expect(resolvePartyId("국민의미래", "2024-04-10", ALIASES)).toBe("people_future_2024");
  });

  it("시대별 매핑: 옛 이름이 옛 시점에서 동작", () => {
    expect(resolvePartyId("새누리당", "2016-04-13", ALIASES)).toBe("people_power");
    expect(resolvePartyId("민주노동당", "2008-04-09", ALIASES)).toBe("minlabour");
  });

  it("시대별 매핑: 옛 이름이 만료 후엔 매칭 안 됨", () => {
    expect(resolvePartyId("새누리당", "2020-04-15", ALIASES)).toBeNull();
    expect(resolvePartyId("민주노동당", "2012-04-11", ALIASES)).toBeNull();
  });

  it("미매핑은 null", () => {
    expect(resolvePartyId("존재하지않는당", "2024-04-10", ALIASES)).toBeNull();
  });
});
