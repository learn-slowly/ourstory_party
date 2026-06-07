// scripts/build/parsers/parse-general-16-19.ts
// 17대(2004) + 18대(2008) 국회의원선거 파서
// (16대 2000년은 단일 XLS에 모든 투표구가 섞인 특수 구조라 시군구 매핑 불가 — skip)
// (19대 2012은 이미 parsed에 있음 — skip)
//
// 17대 지역구 구조 (per-sido xls, sheet=선거구):
//   row0: [투표구명 | 선거인수 | 투표수 | 후보자별 득표수... | 무효 | 기권수]
//   row1: [_ | _ | _ | 정당1 | 정당2 | ... | 계 | 투표수 | _]
//   row2: [_ | _ | _ | 후보1 | 후보2 | ... | _ | _ | _]
//   row3+: 합계 / 부재자 / 소계(읍면동) / 투표구
//
// 17대 비례 구조 (per-sido xls, sheet=선거구):
//   row0: [투표구명 | 선거인수 | 투표수 | 정당별 득표상황... | 무효 | 기권수]
//   row1: [_ | _ | _ | 정당1 | 정당2 | ... | 계 | 투표수 | _]
//   row2: [합계 | ...] (바로 데이터 시작)
//
// 18대 지역구 구조 (per-sido xls, sheet=선거구):
//   row0: [읍면동명 | 투표구명 | 선거인수 | 투표수 | 후보자별 득표상황... | 무효 | 기권수]
//   row1: [_ | _ | _ | _ | 정당1 | 정당2 | ... | 계 | 투표수 | _]
//   row2: [_ | _ | _ | _ | 후보1 | 후보2 | ... | _ | _ | _]
//   row3+: 합계 / 부재자 / 읍면동명(소계) / 투표구 rows

import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ParsedElection, ParsedStationRow } from "../lib/types";

function dec(raw: Buffer): string {
  try { return iconv.decode(raw, "cp949"); } catch { return raw.toString("utf-8"); }
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── 17대 지역구 parser ────────────────────────────────────────────────
// sheet name = 선거구명 (e.g. "종로구")
// col0=투표구명, col1=선거인수, col2=투표수, col3..N-3=party/candidate, N-2=계, N-1=투표수(무효)?, last=기권수
function parse17GeneralSheet(
  sheet: XLSX.WorkSheet,
  sidoName: string,
  sigunguName: string,  // 시트이름에서
  isProportional: boolean
): ParsedStationRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // row1: party names (col3+). Find last "계" to determine end
  const partyRow = json[1] as (string | null)[];
  let endCol = partyRow.length - 1;
  // find rightmost "계" which marks end of party columns
  for (let i = partyRow.length - 1; i >= 3; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 3; i < endCol; i++) {
    const n = partyRow[i];
    if (!n || typeof n !== "string") continue;
    const cleaned = n.trim().replace(/\s+/g, "");
    if (!cleaned || cleaned === "계") continue;
    partyCols.push({ idx: i, name: n.trim() });
  }

  if (partyCols.length === 0) return [];

  // For 지역구: row2 has candidate names → extract party from row1
  // For 비례: row2 is already data (합계 row)

  const dataStartRow = isProportional ? 2 : 3;

  const result: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = dataStartRow; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const col0 = String(row[0] ?? "").trim();
    if (!col0) continue;

    const voters = toNum(row[1]);
    const votes = toNum(row[2]);

    // 합계 행 → sigungu total
    if (col0 === "합계") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "total",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: votes - validVotes,
        parties,
      });
      continue;
    }

    // 부재자 행
    if (col0 === "부재자") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "absentee",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: votes - validVotes,
        parties,
      });
      continue;
    }

    // 소계 행 (읍면동 합계) — 소계 다음 투표구 행에서 emd 이름 추출
    if (col0 === "소계") {
      // Look ahead to find emd name from next station row (e.g., "반송동제1투" → "반송동")
      let emdName = currentEmd;
      for (let k = r + 1; k < Math.min(json.length, r + 3); k++) {
        const nextRow = json[k];
        if (!nextRow) continue;
        const nextCol0 = String(nextRow[0] ?? "").trim();
        if (!nextCol0 || nextCol0 === "소계" || nextCol0 === "합계") break;
        // Extract emd from station name: "반송동제1투" → "반송동"
        const emdMatch = nextCol0.match(/^(.+?)(?:제\d+투|제\d+|투표소)/);
        if (emdMatch) { emdName = emdMatch[1]; break; }
      }
      if (!emdName) { currentEmd = undefined; continue; }

      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName, stationName: null,
        kind: "subtotal",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: votes - validVotes,
        parties,
      });
      currentEmd = emdName;
      continue;
    }

    // 투표구 행 — skip (station-level not needed)
    if (voters > 0 && votes > 0) continue;
  }

  return result;
}

// ── 18대 지역구 parser ────────────────────────────────────────────────
// col0=읍면동명, col1=투표구명, col2=선거인수, col3=투표수, col4..=parties
function parse18GeneralSheet(
  sheet: XLSX.WorkSheet,
  sidoName: string,
  sigunguName: string
): ParsedStationRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (json.length < 4) return [];

  // row1: party names starting from col4
  const partyRow = json[1] as (string | null)[];
  let endCol = partyRow.length - 1;
  for (let i = partyRow.length - 1; i >= 4; i--) {
    if (partyRow[i] === "계") { endCol = i; break; }
  }

  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 4; i < endCol; i++) {
    const n = partyRow[i];
    if (!n || typeof n !== "string") continue;
    const cleaned = n.trim().replace(/\s+/g, "");
    if (!cleaned || cleaned === "계") continue;
    partyCols.push({ idx: i, name: n.trim() });
  }

  if (partyCols.length === 0) return [];

  const result: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const emdCell = String(row[0] ?? "").trim();
    const stationCell = String(row[1] ?? "").trim();
    const voters = toNum(row[2]);
    const votes = toNum(row[3]);

    if (!emdCell && !stationCell) continue;

    // 합계 행
    if (emdCell === "합계" || stationCell === "합계") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "total",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // 부재자 행
    if (emdCell === "부재자" || stationCell === "부재자") {
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);
      result.push({
        sidoName, sigunguName, emdName: null, stationName: null,
        kind: "absentee",
        totalVoters: voters, totalVotes: votes,
        validVotes, invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
      continue;
    }

    // emdCell이 있고 stationCell가 없으면 읍면동명 업데이트
    if (emdCell && !stationCell) {
      currentEmd = emdCell;
      continue;
    }

    // stationCell = "소계" → 읍면동 합계
    if (stationCell === "소계" || stationCell === "") {
      if (emdCell) currentEmd = emdCell;
      if (currentEmd) {
        const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
          .filter(p => p.votes > 0);
        if (parties.length === 0) continue;
        const validVotes = parties.reduce((a, b) => a + b.votes, 0);
        result.push({
          sidoName, sigunguName, emdName: currentEmd, stationName: null,
          kind: "subtotal",
          totalVoters: voters, totalVotes: votes,
          validVotes, invalidVotes: Math.max(0, votes - validVotes),
          parties,
        });
      }
    }
    // else: 투표구명(el_day) — skip
  }

  return result;
}

// ── 16대 총선 파서 ─────────────────────────────────────────────────────
// 단일 XLS: 19,543 행, 227개 선거구 각각 "#선거구명" 헤더 행으로 구분
// 구조: row N = "#선거구명", row N+1 = [투표구명|선거인수|투표수|#후별득|...], row N+2..N+3 = 정당명/후보명, row N+4+ = 데이터
// 합계 행 = col0 "합계", 부재자 = "부재자투표", 소계 = "소계"
//
// 선거구명 → (시도명, 시군구명) 매핑: 16대는 시도별로 선거구가 묶임.
// 선거구명에서 시군구 유추: 창원시갑 → (경상남도, 창원시), 마산시합포구 → (경상남도, 마산시) 등
//
// CP949 인코딩: 파일명은 ok, 셀값도 SheetJS BIFF8 기본 인코딩으로 정상 처리됨

// 선거구명 → (시도, 시군구) 매핑 테이블
// 총 227개 선거구를 모두 커버하는 대신, 전국 주요 패턴을 통해 동적으로 추정
function inferRegion16(constName: string): { sidoName: string; sigunguName: string } {
  // 직접 매핑 (패턴 매칭으로 처리 안 되는 특수 선거구)
  const DIRECT_MAP: Record<string, { sidoName: string; sigunguName: string }> = {
    // 부산 - 구 이름이 광역시 이름 없이 쓰임
    "서구": { sidoName: "부산광역시", sigunguName: "서구" },
    "중동구": { sidoName: "부산광역시", sigunguName: "중구" },
    "영도구": { sidoName: "부산광역시", sigunguName: "영도구" },
    "동래구": { sidoName: "부산광역시", sigunguName: "동래구" },
    "남구": { sidoName: "부산광역시", sigunguName: "남구" },
    "북구강서구갑": { sidoName: "부산광역시", sigunguName: "북구" },
    "북구강서구을": { sidoName: "부산광역시", sigunguName: "강서구" },
    "해운대구기장군갑": { sidoName: "부산광역시", sigunguName: "해운대구" },
    "해운대구기장군을": { sidoName: "부산광역시", sigunguName: "기장군" },
    "사하구갑": { sidoName: "부산광역시", sigunguName: "사하구" },
    "사하구을": { sidoName: "부산광역시", sigunguName: "사하구" },
    "금정구": { sidoName: "부산광역시", sigunguName: "금정구" },
    "연제구": { sidoName: "부산광역시", sigunguName: "연제구" },
    "수영구": { sidoName: "부산광역시", sigunguName: "수영구" },
    "사상구": { sidoName: "부산광역시", sigunguName: "사상구" },
    // 대구 - 구 이름이 접두사 없이 쓰임
    "중구": { sidoName: "대구광역시", sigunguName: "중구" },
    "동구": { sidoName: "대구광역시", sigunguName: "동구" },
    "서구": { sidoName: "대구광역시", sigunguName: "서구" },
    "남구": { sidoName: "대구광역시", sigunguName: "남구" },
    "수성구갑": { sidoName: "대구광역시", sigunguName: "수성구" },
    "수성구을": { sidoName: "대구광역시", sigunguName: "수성구" },
    "달서구갑": { sidoName: "대구광역시", sigunguName: "달서구" },
    "달서구을": { sidoName: "대구광역시", sigunguName: "달서구" },
    "달성군": { sidoName: "대구광역시", sigunguName: "달성군" },
    // 인천 - 구 이름이 접두사 없이
    "연수구": { sidoName: "인천광역시", sigunguName: "연수구" },
    "남동구갑": { sidoName: "인천광역시", sigunguName: "남동구" },
    "남동구을": { sidoName: "인천광역시", sigunguName: "남동구" },
    "부평구갑": { sidoName: "인천광역시", sigunguName: "부평구" },
    "부평구을": { sidoName: "인천광역시", sigunguName: "부평구" },
    "계양구": { sidoName: "인천광역시", sigunguName: "계양구" },
    "서구.강화군갑": { sidoName: "인천광역시", sigunguName: "서구" },
    "서구.강화군을": { sidoName: "인천광역시", sigunguName: "강화군" },
    // 광주 - (광주) 접미사
    "동구(광주)": { sidoName: "광주광역시", sigunguName: "동구" },
    "서구(광주)": { sidoName: "광주광역시", sigunguName: "서구" },
    "남구(광주)": { sidoName: "광주광역시", sigunguName: "남구" },
    "광산구": { sidoName: "광주광역시", sigunguName: "광산구" },
    // 대전 - (대전) 접미사
    "동구(대전)": { sidoName: "대전광역시", sigunguName: "동구" },
    "유성구": { sidoName: "대전광역시", sigunguName: "유성구" },
    "대덕구": { sidoName: "대전광역시", sigunguName: "대덕구" },
    // 울산 - (울산) 접미사
    "남구(울산)": { sidoName: "울산광역시", sigunguName: "남구" },
    "동구(울산)": { sidoName: "울산광역시", sigunguName: "동구" },
    "북구(울산)": { sidoName: "울산광역시", sigunguName: "북구" },
    "울주군": { sidoName: "울산광역시", sigunguName: "울주군" },
  };

  if (DIRECT_MAP[constName]) return DIRECT_MAP[constName];

  // 서울 선거구 (구 단위)
  const seoulDistricts = [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구",
    "성북구", "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구",
    "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구",
    "서초구", "강남구", "송파구", "강동구",
  ];
  for (const d of seoulDistricts) {
    if (constName.startsWith(d) || constName.replace(/갑|을$/, "") === d) {
      return { sidoName: "서울특별시", sigunguName: d };
    }
  }

  // 부산 선거구
  const busanDistricts = [
    "서구", "중동구", "영도구", "부산진구", "동래구", "남구", "북구",
    "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군",
  ];
  for (const d of busanDistricts) {
    const base = constName.replace(/갑|을$/, "");
    if (base === d || constName.startsWith(d + "갑") || constName.startsWith(d + "을")) {
      return { sidoName: "부산광역시", sigunguName: d };
    }
  }
  // 부산 중구/서구 특수 처리
  if (constName === "중동구") return { sidoName: "부산광역시", sigunguName: "중구" };

  // 대구, 인천, 광주, 대전, 울산 광역시
  const metroMap: Record<string, string> = {
    "중구(서울)": "중구", // already covered above
  };

  // 광역시별 선거구 패턴 - 시 이름으로 시작하는 경우
  const metroRegions = [
    { prefix: "대구", sido: "대구광역시" },
    { prefix: "인천", sido: "인천광역시" },
    { prefix: "광주", sido: "광주광역시" },
    { prefix: "대전", sido: "대전광역시" },
    { prefix: "울산", sido: "울산광역시" },
  ];
  for (const { prefix, sido } of metroRegions) {
    if (constName.startsWith(prefix)) {
      // "대구북구" → "북구", "인천남구갑" → "남구"
      const rest = constName.substring(prefix.length).replace(/갑|을$/, "");
      return { sidoName: sido, sigunguName: rest || prefix };
    }
  }

  // 경기도
  const gyeonggiCities = [
    "수원", "성남", "의정부", "안양", "부천", "광명", "평택", "동두천",
    "안산", "고양", "과천", "구리", "남양주", "오산", "시흥", "군포",
    "의왕", "하남", "용인", "파주", "이천", "안성", "김포", "화성",
    "광주", "양주", "포천", "여주", "연천", "가평", "양평",
  ];
  for (const c of gyeonggiCities) {
    if (constName.startsWith(c)) {
      const fullName = constName.replace(/갑|을$/, "").replace(/시$/, "") + "시";
      // 확인: constName이 도시로 시작하면 경기도
      return { sidoName: "경기도", sigunguName: fullName };
    }
  }

  // 강원도
  const gangwonCities = [
    "춘천", "원주", "강릉", "동해", "태백", "속초", "삼척", "홍천",
    "횡성", "영월", "평창", "정선", "철원", "화천", "양구", "인제", "고성",
    "양양",
  ];
  for (const c of gangwonCities) {
    if (constName.startsWith(c)) {
      return { sidoName: "강원도", sigunguName: constName.replace(/갑|을$/, "") };
    }
  }

  // 충청도
  const chungbukCities = ["청주", "충주", "제천", "청원", "보은", "옥천", "영동", "증평", "진천", "괴산", "음성", "단양"];
  for (const c of chungbukCities) {
    if (constName.startsWith(c)) return { sidoName: "충청북도", sigunguName: constName.replace(/갑|을$/, "") };
  }
  const chungnamCities = ["천안", "공주", "보령", "아산", "서산", "논산", "계룡", "당진", "금산", "부여", "서천", "청양", "홍성", "예산", "태안"];
  for (const c of chungnamCities) {
    if (constName.startsWith(c)) return { sidoName: "충청남도", sigunguName: constName.replace(/갑|을$/, "") };
  }

  // 전라도
  const jeonbukCities = ["전주", "군산", "익산", "정읍", "남원", "김제", "완주", "진안", "무주", "장수", "임실", "순창", "고창", "부안"];
  for (const c of jeonbukCities) {
    if (constName.startsWith(c)) return { sidoName: "전라북도", sigunguName: constName.replace(/갑|을$/, "") };
  }
  const jeonnamCities = ["목포", "여수", "순천", "나주", "광양", "담양", "곡성", "구례", "고흥", "보성", "화순", "장흥", "강진", "해남", "영암", "무안", "함평", "영광", "장성", "완도", "진도", "신안"];
  for (const c of jeonnamCities) {
    if (constName.startsWith(c)) return { sidoName: "전라남도", sigunguName: constName.replace(/갑|을$/, "") };
  }

  // 경상도
  const gyeongbukCities = ["포항", "경주", "김천", "안동", "구미", "영주", "영천", "상주", "문경", "경산", "군위", "의성", "청송", "영양", "영덕", "청도", "고령", "성주", "칠곡", "예천", "봉화", "울진", "울릉"];
  for (const c of gyeongbukCities) {
    if (constName.startsWith(c)) return { sidoName: "경상북도", sigunguName: constName.replace(/갑|을$/, "") };
  }
  const gyeongnamCities = ["창원", "마산", "진주", "진해", "통영", "사천", "김해", "밀양", "거제", "양산", "의령", "함안", "창녕", "고성", "남해", "하동", "산청", "함양", "거창", "합천"];
  for (const c of gyeongnamCities) {
    if (constName.startsWith(c)) {
      const base = constName.replace(/갑|을|합포구|회원구$/, "").replace(/시고성군$/, "시");
      // 통영시고성군 → 통영시 + 고성군 (두 시군구) — 여기서는 통영시로만 귀속
      const sigunguName = base.endsWith("시") || base.endsWith("군") ? base : base + "시";
      return { sidoName: "경상남도", sigunguName };
    }
  }

  // 제주
  if (constName.startsWith("북제주") || constName.startsWith("남제주") ||
      constName.startsWith("제주") || constName.startsWith("서귀포")) {
    const sigungu = constName.replace(/갑|을$/, "");
    return { sidoName: "제주특별자치도", sigunguName: sigungu };
  }

  // 세종 (없음 — 2000년엔 세종시 없음)
  return { sidoName: "", sigunguName: constName.replace(/갑|을$/, "") };
}

// 16대 총선 XLS 파서 (단일 XLS, 복수 선거구)
// 각 선거구 섹션: row "#선거구명" → rows 1-3 헤더 → rows 4+ 데이터
function parse16GeneralXls(xls: Buffer): ParsedStationRow[] {
  const wb = XLSX.read(xls, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const result: ParsedStationRow[] = [];

  // 섹션별 상태
  let constName = "";
  let sidoName = "";
  let sigunguName = "";
  let partyCols: Array<{ idx: number; name: string }> = [];
  let inSection = false;
  let headerPhase = 0;  // 0=섹션헤더, 1=컬럼헤더, 2=정당명행(2개), 3=후보명행, 4+=데이터

  for (let r = 0; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;
    const col0 = String(row[0] ?? "").trim();

    // 새 선거구 섹션 시작
    if (col0.startsWith("#") && col0.length > 1) {
      constName = col0.substring(1);
      const region = inferRegion16(constName);
      sidoName = region.sidoName;
      sigunguName = region.sigunguName;
      partyCols = [];
      inSection = true;
      headerPhase = 1;
      continue;
    }

    if (!inSection) continue;

    // 헤더 행 파싱
    if (headerPhase === 1) {
      // row[1]: [투표구명 | 선거인수 | 투표수 | #후별득 | ...]
      // "#후별득" 을 만나면 다음이 정당명
      headerPhase = 2;
      continue;
    }
    if (headerPhase === 2) {
      // 정당명 행 1: col3+ 에 정당명들 (공백 포함)
      // 일부 셀은 null (2줄로 나뉨)
      // col3~ 에서 "계" 찾기
      const row2 = row as (string | null)[];
      let endCol = row2.length - 1;
      for (let i = row2.length - 1; i >= 3; i--) {
        const v = String(row2[i] ?? "").trim();
        if (v === "계") { endCol = i; break; }
      }
      if (endCol === row2.length - 1) {
        // "계" 없으면 무효/기권 앞 col 탐색
        for (let i = row2.length - 1; i >= 3; i--) {
          const v = String(row2[i] ?? "").trim();
          if (v && v !== "무효" && v !== "기권수" && !v.includes("투표수")) { endCol = i; break; }
        }
      }
      // 정당명 누적
      partyCols = [];
      for (let i = 3; i < endCol; i++) {
        const n = row2[i];
        if (!n) continue;
        const s = String(n).trim().replace(/\s+/g, " ");
        if (!s || s === "계" || s.includes("무효") || s.includes("기권")) continue;
        partyCols.push({ idx: i, name: s });
      }
      headerPhase = 3;
      continue;
    }
    if (headerPhase === 3) {
      // 정당명 행 2 (이어지는 당명 하단 부분) — 후보명 행일 수도 있음
      // 16대 헤더: row2="새 천 년", row3="민 주 당" → 합쳐서 "새천년민주당"
      const row3 = row as (string | null)[];
      // 이 행이 정당명 연속행인지 후보명행인지 판별:
      // 정당명 연속행 = col3+ 에 당명 조각이 있음 (후보명 = 성명)
      // 판별: col3+ 에 값이 있고, 값이 한글로 짧은 단어면 정당명 연속
      let isContinuationRow = false;
      for (const pc of partyCols) {
        const extra = String(row3[pc.idx] ?? "").trim();
        if (extra && extra !== "계" && !extra.includes("무효") && !extra.includes("기권")) {
          // 값이 있으면 연속 정당명으로 간주
          isContinuationRow = true;
          break;
        }
      }
      if (isContinuationRow) {
        for (let i = 0; i < partyCols.length; i++) {
          const pc = partyCols[i];
          const extra = String(row3[pc.idx] ?? "").trim();
          if (extra && extra !== "계" && !extra.includes("무효") && !extra.includes("기권")) {
            // 공백 구분자로 합침 → 나중에 정규화
            pc.name = (pc.name.trim() + " " + extra).trim();
          }
        }
        headerPhase = 4;  // 다음이 후보명 행
      } else {
        headerPhase = 4;  // 이미 후보명 행이었거나 데이터 바로 시작
      }
      // 정당명 정규화: "새 천 년 민 주 당" → "새천년민주당"
      for (const pc of partyCols) {
        pc.name = pc.name.replace(/\s+/g, "");
      }
      // 무소속 중복 → "무소속"으로 통일 (두 번째 무소속 후보도 같은 당이름)
      // 두 번째 이후 "무소속" 계열 후보는 suffix 추가 가능하나 여기서는 모두 "무소속"으로
      for (const pc of partyCols) {
        if (pc.name.startsWith("무소속")) pc.name = "무소속";
        if (pc.name === "소속" || pc.name === "무") pc.name = "무소속";
      }
      continue;
    }
    if (headerPhase === 4) {
      // 후보명 행 (skip) — 혹은 바로 데이터
      // col0이 숫자 없이 "부재자투표" or "합계" or 읍동명이면 데이터 시작
      const isData = col0 === "합계" || col0 === "부재자투표" || col0 === "소계" ||
        (col0 && !col0.includes("후보") && !col0.includes("득표") && !col0.includes("투표구"));
      if (!isData) continue;
      headerPhase = 5;
      // fall through to data processing
    }

    // 데이터 행 처리
    if (headerPhase >= 5 && partyCols.length > 0) {
      if (!col0) continue;

      const voters = toNum(row[1]);
      const votes = toNum(row[2]);
      const parties = partyCols.map(pc => ({ rawName: pc.name, votes: toNum(row[pc.idx]) }))
        .filter(p => p.votes > 0);
      if (parties.length === 0) continue;
      const validVotes = parties.reduce((a, b) => a + b.votes, 0);

      let kind: ParsedStationRow["kind"];
      let emdName: string | null = null;

      if (col0 === "합계") {
        kind = "total";
      } else if (col0 === "부재자투표" || col0 === "부재자") {
        kind = "absentee";
      } else if (col0 === "소계") {
        kind = "subtotal";
      } else {
        // 투표구 행 — skip (너무 세분화, emd 없음)
        continue;
      }

      if (kind !== "total" && kind !== "absentee") continue;  // 합계·부재자만 저장

      result.push({
        sidoName,
        sigunguName,
        emdName,
        stationName: null,
        kind,
        totalVoters: voters,
        totalVotes: votes,
        validVotes,
        invalidVotes: Math.max(0, votes - validVotes),
        parties,
      });
    }
  }

  return result;
}

// ── 시도명 정규화 ─────────────────────────────────────────────────────
function normalizeSidoName(rawFilename: string): string {
  const map: Record<string, string> = {
    "01 서울": "서울특별시",
    "02 부산": "부산광역시",
    "03 대구": "대구광역시",
    "04 인천": "인천광역시",
    "05 광주": "광주광역시",
    "06 대전": "대전광역시",
    "07 울산": "울산광역시",
    "08 경기": "경기도",
    "09 강원": "강원도",
    "10 충북": "충청북도",
    "11 충남": "충청남도",
    "12 전북": "전라북도",
    "13 전남": "전라남도",
    "14 경북": "경상북도",
    "15 경남": "경상남도",
    "16 제주": "제주특별자치도",
  };
  for (const [k, v] of Object.entries(map)) {
    if (rawFilename.includes(k)) return v;
  }
  return rawFilename;
}

function normalizeSido18(rawFilename: string): string {
  const map: Record<string, string> = {
    서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시",
    인천: "인천광역시", 광주: "광주광역시", 대전: "대전광역시",
    울산: "울산광역시", 경기: "경기도", 강원: "강원도",
    충북: "충청북도", 충남: "충청남도", 전북: "전라북도",
    전남: "전라남도", 경북: "경상북도", 경남: "경상남도",
    제주: "제주특별자치도",
  };
  for (const [k, v] of Object.entries(map)) {
    if (rawFilename.includes(k)) return v;
  }
  return rawFilename;
}

// ── 16대 총선 파서 (공개 export) ──────────────────────────────────────
export function parse2000General(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner16 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("16대") && n.endsWith(".zip");
  });
  if (!inner16) throw new Error("16대 zip not found");

  const zip16 = new AdmZip(inner16.getData());
  const xlsEntry = zip16.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return !e.isDirectory && (n.endsWith(".xls") || n.endsWith(".xlsx"));
  });
  if (!xlsEntry) throw new Error("16대 XLS not found");

  const allRows = parse16GeneralXls(xlsEntry.getData());
  const partySet = new Set<string>();
  for (const r of allRows) r.parties.forEach(p => partySet.add(p.rawName));

  return {
    electionId: "2000-general",
    electionDate: "2000-04-13",
    rows: allRows,
    partyNames: [...partySet],
  };
}

// ── 17대 총선 파서 ─────────────────────────────────────────────────────
export function parse2004General(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner17 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("17대") && n.endsWith(".zip");
  });
  if (!inner17) throw new Error("17대 zip not found");

  const zip17 = new AdmZip(inner17.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of zip17.getEntries()) {
    const name = dec(Buffer.from(entry.rawEntryName));
    if (!name.includes("지역구") || !name.endsWith(".xls")) continue;
    if (entry.isDirectory) continue;

    const sidoName = normalizeSidoName(name);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = parse17GeneralSheet(sheet, sidoName, sheetName, false);
      for (const r of rows) {
        r.parties.forEach(p => partySet.add(p.rawName));
        allRows.push(r);
      }
    }
  }

  return {
    electionId: "2004-general",
    electionDate: "2004-04-15",
    rows: allRows,
    partyNames: [...partySet],
  };
}

export function parse2004GeneralProp(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner17 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("17대") && n.endsWith(".zip");
  });
  if (!inner17) throw new Error("17대 zip not found");

  const zip17 = new AdmZip(inner17.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of zip17.getEntries()) {
    const name = dec(Buffer.from(entry.rawEntryName));
    if (!name.includes("비례대표") || !name.endsWith(".xls")) continue;
    if (entry.isDirectory) continue;

    const sidoName = normalizeSidoName(name);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = parse17GeneralSheet(sheet, sidoName, sheetName, true);
      for (const r of rows) {
        r.parties.forEach(p => partySet.add(p.rawName));
        allRows.push(r);
      }
    }
  }

  return {
    electionId: "2004-general-prop",
    electionDate: "2004-04-15",
    rows: allRows,
    partyNames: [...partySet],
  };
}

// ── 18대 총선 파서 ─────────────────────────────────────────────────────
export function parse2008General(zipPath: string): ParsedElection {
  const outerZip = new AdmZip(zipPath);
  const inner18 = outerZip.getEntries().find(e => {
    const n = dec(Buffer.from(e.rawEntryName));
    return n.includes("18대") && n.endsWith(".zip");
  });
  if (!inner18) throw new Error("18대 zip not found");

  const zip18 = new AdmZip(inner18.getData());
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();

  for (const entry of zip18.getEntries()) {
    const name = dec(Buffer.from(entry.rawEntryName));
    if (!name.includes("지역구") || !name.endsWith(".xls")) continue;
    if (entry.isDirectory) continue;

    const sidoName = normalizeSido18(name);
    const wb = XLSX.read(entry.getData(), { type: "buffer" });

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = parse18GeneralSheet(sheet, sidoName, sheetName);
      for (const r of rows) {
        r.parties.forEach(p => partySet.add(p.rawName));
        allRows.push(r);
      }
    }
  }

  return {
    electionId: "2008-general",
    electionDate: "2008-04-09",
    rows: allRows,
    partyNames: [...partySet],
  };
}

// 18대 비례 — 17대 비례와 동일 구조지만 18대 zip 내 비례 폴더를 찾아야 함
// 실제로는 별도 파일이 없음 — 18대 zip에는 지역구만 있음
// 비례대표 개표자료는 별도 파일 없이 지역구 zip에만 포함됨
// → 18대 비례는 skip (데이터 없음)
export function parse2008GeneralProp(zipPath: string): ParsedElection {
  // 18대 총선 비례 데이터는 16~19대 zip에 없음
  return {
    electionId: "2008-general-prop",
    electionDate: "2008-04-09",
    rows: [],
    partyNames: [],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const zipPath = "/Users/ahbaik/Downloads/국회의원선거 개표결과(제16대~19대).zip";
  const outDir = "data/parsed";
  mkdirSync(outDir, { recursive: true });

  console.log("▶ 2000-general...");
  const g2000 = parse2000General(zipPath);
  console.log(`  rows=${g2000.rows.length}  parties=${g2000.partyNames.length}`);
  writeFileSync(path.join(outDir, "2000-general.json"), JSON.stringify(g2000));

  console.log("▶ 2004-general...");
  const g2004 = parse2004General(zipPath);
  console.log(`  rows=${g2004.rows.length}  parties=${g2004.partyNames.length}`);
  writeFileSync(path.join(outDir, "2004-general.json"), JSON.stringify(g2004));

  console.log("▶ 2004-general-prop...");
  const g2004p = parse2004GeneralProp(zipPath);
  console.log(`  rows=${g2004p.rows.length}  parties=${g2004p.partyNames.length}`);
  writeFileSync(path.join(outDir, "2004-general-prop.json"), JSON.stringify(g2004p));

  console.log("▶ 2008-general...");
  const g2008 = parse2008General(zipPath);
  console.log(`  rows=${g2008.rows.length}  parties=${g2008.partyNames.length}`);
  writeFileSync(path.join(outDir, "2008-general.json"), JSON.stringify(g2008));

  console.log("Done.");
}
