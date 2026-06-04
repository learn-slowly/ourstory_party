import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

// Server Components 에서 사용. anon 키 + RLS 로 SELECT 만 허용.
// DATABASE_URL 은 서버에서만 접근 가능 (PUBLIC_ 접두 없음).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 미설정 (서버 환경에서만 호출)");

export const sql = postgres(url, { prepare: false, max: 5 });
export const db = drizzle(sql, { schema });
