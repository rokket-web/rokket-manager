import { describe, expect, it, vi } from "vitest";

vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

import { isTransientDbError, withRetry } from "./db";

describe("withRetry", () => {
  it("retries transient errors then succeeds", async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        if (++n < 3) throw new Error("Connection terminated unexpectedly");
        return "ok";
      },
      3,
      1,
    );
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });
  it("does not retry non-transient errors", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error("unique constraint failed");
        },
        3,
        1,
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
  it("classifies cold-start errors as transient", () => {
    expect(isTransientDbError(new Error("connect ETIMEDOUT"))).toBe(true);
    expect(isTransientDbError(new Error("syntax error"))).toBe(false);
  });
});
