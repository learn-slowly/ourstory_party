// scripts/build/station-grouping.test.ts
import { describe, it, expect } from "vitest";
import { buildStationListByEmd } from "./build-static";

describe("buildStationListByEmd", () => {
  const emdToParent = {
    "4812011000": { sigunguName: "창원시", emdName: "상남동" },
    "4812011500": { sigunguName: "창원시", emdName: "사파동" },
  };

  it("prefix 매칭 station 만 group 에 들어감", () => {
    const stations = [
      "창원시-상남동-상남제1투",
      "창원시-상남동-상남제2투",
      "창원시-사파동-사파제1투",
      "진주시-문산읍-문산제1투",
    ];
    const r = buildStationListByEmd(emdToParent, stations);
    expect(r["4812011000"]).toEqual(["상남제1투", "상남제2투"]);
    expect(r["4812011500"]).toEqual(["사파제1투"]);
    expect(r["4817056000"]).toBeUndefined();
  });

  it("매칭 station 0개인 emd 는 결과에 안 들어감", () => {
    const r = buildStationListByEmd(emdToParent, ["진주시-문산읍-문산제1투"]);
    expect(Object.keys(r)).toHaveLength(0);
  });

  it("한국어 로케일 정렬", () => {
    const r = buildStationListByEmd(emdToParent, [
      "창원시-상남동-상남제3투",
      "창원시-상남동-상남제1투",
      "창원시-상남동-상남제2투",
    ]);
    expect(r["4812011000"]).toEqual(["상남제1투", "상남제2투", "상남제3투"]);
  });
});
