// Runs `prisma migrate deploy` with retries so a Neon cold start (scale-to-zero)
// or a transient P1001 doesn't fail the build. Uses DIRECT_URL via prisma.config.ts.
import { spawnSync } from "node:child_process";

const attempts = 6;
for (let i = 1; i <= attempts; i++) {
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.status === 0) process.exit(0);
  const out = `${r.stdout}${r.stderr}`;
  if (!/P1001|P1002|P1017|ETIMEDOUT|ECONNRESET/.test(out) || i === attempts) process.exit(r.status ?? 1);
  const wait = Math.min(5000 * i, 20000);
  console.warn(`[migrate] database unreachable (attempt ${i}/${attempts}); retrying in ${wait / 1000}s...`);
  await new Promise((res) => setTimeout(res, wait));
}
