import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql, db } from "../../src/lib/db-admin";
import { electionPartyOverrides, partyAliases, parties, elections } from "../../db/schema";
import { resolveParty } from "../../scripts/ingest/lib/party-resolver";
import { eq } from "drizzle-orm";

const TEST_ELECTION = "test-1.1-election";
const TEST_OVERRIDE_RAW = "테스트당";
const TEST_ALIAS_RAW = "테스트별칭";

beforeEach(async () => {
  await db.delete(electionPartyOverrides).where(eq(electionPartyOverrides.electionId, TEST_ELECTION));
  await db.delete(partyAliases).where(eq(partyAliases.alias, TEST_ALIAS_RAW));
  await db.delete(partyAliases).where(eq(partyAliases.alias, TEST_OVERRIDE_RAW));
  await db.delete(elections).where(eq(elections.id, TEST_ELECTION));
  await db.insert(elections).values({ id: TEST_ELECTION, date: "2025-01-01", type: "presidential", name: "테스트" });
});

afterEach(async () => {
  await db.delete(electionPartyOverrides).where(eq(electionPartyOverrides.electionId, TEST_ELECTION));
  await db.delete(partyAliases).where(eq(partyAliases.alias, TEST_ALIAS_RAW));
  await db.delete(partyAliases).where(eq(partyAliases.alias, TEST_OVERRIDE_RAW));
  await db.delete(elections).where(eq(elections.id, TEST_ELECTION));
});

describe("resolveParty", () => {
  it("override 가 alias 보다 우선", async () => {
    await db.insert(electionPartyOverrides).values({
      electionId: TEST_ELECTION, rawName: TEST_OVERRIDE_RAW, partyId: "justice",
    });
    await db.insert(partyAliases).values({
      alias: TEST_OVERRIDE_RAW, partyId: "democratic", validFrom: "2000-01-01",
    });
    const r = await resolveParty(TEST_ELECTION, "2025-01-01", TEST_OVERRIDE_RAW);
    expect(r).toBe("justice");
  });

  it("alias 시기 매칭 — validFrom/validUntil 내", async () => {
    await db.insert(partyAliases).values({
      alias: TEST_ALIAS_RAW, partyId: "justice",
      validFrom: "2020-01-01", validUntil: "2030-12-31",
    });
    expect(await resolveParty(TEST_ELECTION, "2025-01-01", TEST_ALIAS_RAW)).toBe("justice");
  });

  it("alias 시기 범위 밖이면 null", async () => {
    await db.insert(partyAliases).values({
      alias: TEST_ALIAS_RAW, partyId: "justice",
      validFrom: "2000-01-01", validUntil: "2010-12-31",
    });
    expect(await resolveParty(TEST_ELECTION, "2025-01-01", TEST_ALIAS_RAW)).toBeNull();
  });

  it("매칭 실패 시 null", async () => {
    expect(await resolveParty(TEST_ELECTION, "2025-01-01", "존재하지않는당")).toBeNull();
  });
});
