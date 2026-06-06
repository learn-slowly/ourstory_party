import {
  pgTable, text, integer, date, boolean, numeric, timestamp, bigserial,
  bigint, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// 지역: 시·도 / 시·군·구 / 읍·면·동
export const regions = pgTable(
  "regions",
  {
    code: text("code").primaryKey(),
    level: text("level", { enum: ["sido", "sigungu", "emd"] }).notNull(),
    name: text("name").notNull(),
    parentCode: text("parent_code").references((): any => regions.code),
    displayOrder: integer("display_order"),
  },
  (t) => ({
    parentIdx: index("regions_parent_idx").on(t.parentCode),
  }),
);

// 선거
export const elections = pgTable("elections", {
  id: text("id").primaryKey(),
  date: date("date").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  necElectionId: text("nec_election_id"),
  necCode: text("nec_code"),
  isByelection: boolean("is_byelection").notNull().default(false),
  displayOrder: integer("display_order"),
});

// 정당
export const parties = pgTable("parties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  family: text("family").notNull(),
  color: text("color").notNull(),
  satelliteOf: text("satellite_of").references((): any => parties.id),
  activeFrom: date("active_from"),
  activeUntil: date("active_until"),
});

// 정당 alias (시대별)
export const partyAliases = pgTable(
  "party_aliases",
  {
    alias: text("alias").notNull(),
    partyId: text("party_id").notNull().references(() => parties.id),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.alias, t.validFrom] }) }),
);

// 지역×선거×정당 득표
export const voteTotals = pgTable(
  "vote_totals",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    regionCode: text("region_code").notNull().references(() => regions.code),
    partyId: text("party_id").notNull().references(() => parties.id),
    votes: integer("votes").notNull(),
    rank: integer("rank"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.electionId, t.regionCode, t.partyId] }),
    regionIdx: index("vt_region_idx").on(t.regionCode, t.electionId),
    partyIdx: index("vt_party_idx").on(t.partyId, t.electionId),
  }),
);

// 지역 분모
export const regionTotals = pgTable(
  "region_totals",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    regionCode: text("region_code").notNull().references(() => regions.code),
    totalVoters: integer("total_voters"),
    totalVotes: integer("total_votes"),
    validVotes: integer("valid_votes"),
    invalidVotes: integer("invalid_votes"),
    progressPct: numeric("progress_pct", { precision: 5, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.electionId, t.regionCode] }) }),
);

// 지역구 후보자
export const candidates = pgTable(
  "candidates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    electionId: text("election_id").notNull().references(() => elections.id),
    constituency: text("constituency").notNull(),
    regionCode: text("region_code").references(() => regions.code),
    partyId: text("party_id").references(() => parties.id),
    partyNameRaw: text("party_name_raw"),
    name: text("name").notNull(),
    votes: integer("votes"),
    isWinner: boolean("is_winner").notNull().default(false),
  },
  (t) => ({
    electionConstIdx: index("cand_election_const_idx").on(t.electionId, t.constituency),
  }),
);

// 선거 단위 정당 매핑 강제 (정치 판단 케이스)
export const electionPartyOverrides = pgTable(
  "election_party_overrides",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    rawName: text("raw_name").notNull(),
    partyId: text("party_id").notNull().references(() => parties.id),
    note: text("note"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.electionId, t.rawName] }) }),
);

// 투표소(NEC 용어 "투표구") — 자연키: (election_id, sigungu_code, emd_code, name)
export const pollingStations = pgTable(
  "polling_stations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    electionId: text("election_id").notNull().references(() => elections.id),
    sigunguCode: text("sigungu_code").notNull().references(() => regions.code),
    emdCode: text("emd_code").references(() => regions.code),
    name: text("name").notNull(),
    kind: text("kind", {
      // emd-level (역대 archive 의 최저 단위):
      //   "el_day"   — emd 단위 선거일 본투표 합 ("선거일투표")
      //   "presub"   — emd 단위 관내사전투표 합
      // 시·군·구 단위 메타 (특정 emd 귀속 불가):
      //   "abs"      — 관외사전투표
      //   "absentee" — 거소·선상투표
      //   "overseas" — 재외투표
      //   "misc"     — 잘못 투입·구분된 투표지 등
      // 라이브 선거 전용 (NEC live 모듈 VCCP08 운영 기간에만):
      //   "station"  — 개별 투표소 ("제1투표소" 류). 역대 archive 에는 미존재
      enum: ["el_day", "presub", "abs", "absentee", "overseas", "misc", "station"],
    }).notNull(),
    necTownCode: text("nec_town_code"),
  },
  (t) => ({
    uq: uniqueIndex("ps_uq").on(t.electionId, t.sigunguCode, t.emdCode, t.name),
    emdIdx: index("ps_emd_idx").on(t.electionId, t.emdCode),
  }),
);

// 투표소 단위 정당 득표
export const pollingStationVotes = pgTable(
  "polling_station_votes",
  {
    stationId: bigint("station_id", { mode: "number" })
      .notNull()
      .references(() => pollingStations.id, { onDelete: "cascade" }),
    partyId: text("party_id").references(() => parties.id),
    rawName: text("raw_name").notNull(),
    votes: integer("votes").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.stationId, t.rawName] }),
    partyIdx: index("psv_party_idx").on(t.partyId),
  }),
);

// 투표소 단위 분모
export const pollingStationTotals = pgTable(
  "polling_station_totals",
  {
    stationId: bigint("station_id", { mode: "number" })
      .primaryKey()
      .references(() => pollingStations.id, { onDelete: "cascade" }),
    totalVoters: integer("total_voters"),
    totalVotes: integer("total_votes"),
    validVotes: integer("valid_votes"),
    invalidVotes: integer("invalid_votes"),
  },
);
