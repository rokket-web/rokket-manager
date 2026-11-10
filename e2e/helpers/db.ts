import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

if (/ep-late-recipe/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Refusing to run e2e DB helpers against production.");
}

let pool: Pool | undefined;

/** Plain SQL for e2e setup/cleanup (Playwright cannot load the generated Prisma client). Never production. */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15_000 });
  return (await pool.query(text, params)).rows as T[];
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 25);
export const newToken = () => randomBytes(24).toString("base64url");
