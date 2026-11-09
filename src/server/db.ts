import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Neon scale-to-zero: keep the pool small, drop idle connections quickly, and
// fail fast on connect so retries (below) can ride out a cold compute wake-up.
function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForDb.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.prisma = db;

const TRANSIENT =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|terminating connection|Connection terminated|timeout exceeded|P1001|P1002|P1017/i;

export function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const code = (err as { code?: string } | null)?.code ?? "";
  return TRANSIENT.test(`${msg} ${code}`);
}

/** Retry read-style operations on transient connection errors (cold starts). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 250): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
