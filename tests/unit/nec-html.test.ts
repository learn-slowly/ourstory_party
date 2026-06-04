import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseVccpAggregate } from "../../scripts/ingest/lib/nec-html";

const FIXTURE = path.join(__dirname, "..", "fixtures", "nec-vccp08-2025-jinju.html");

describe("nec-html parser", () => {
  it("2025 진주시 대선 합계 파싱", async () => {
    const html = await readFile(FIXTURE, "utf-8");
    const result = parseVccpAggregate(html);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.totalVoters).toBe(289796);
    expect(result.totalVotes).toBe(231564);
    expect(result.validVotes).toBe(229518);

    // 5명 후보 (대선이므로 정당+후보명 결합)
    expect(result.parties.length).toBe(5);

    const find = (name: string) => result.parties.find((p) => p.name === name);
    expect(find("더불어민주당이재명")?.votes).toBe(80491);
    expect(find("국민의힘김문수")?.votes).toBe(127358);
    expect(find("개혁신당이준석")?.votes).toBe(19197);
    expect(find("민주노동당권영국")?.votes).toBe(2198);
    expect(find("무소속송진호")?.votes).toBe(274);
  });

  it("빈 응답 ('검색된 결과가 없습니다') 처리", () => {
    const html = `<table id="table01"><tbody><tr><td colspan="7" class="alignC">검색된 결과가 없습니다.</td></tr></tbody></table>`;
    const result = parseVccpAggregate(html);
    expect(result.kind).toBe("no-data");
  });

  it("정당 컬럼 0개면 no-data", () => {
    const html = `<table id="table01">
      <thead><tr><th>읍면동명</th><th>구분</th><th>선거인수</th><th>투표수</th><th>무효</th><th>기권자수</th></tr></thead>
      <tbody><tr><td>합계</td><td></td><td>100</td><td>50</td><td>2</td><td>48</td></tr></tbody>
    </table>`;
    const result = parseVccpAggregate(html);
    expect(result.kind).toBe("no-data");
  });
});
