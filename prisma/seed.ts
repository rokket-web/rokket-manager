import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { hashPassword } from "better-auth/crypto";
import { db } from "../src/server/db";

// Dev/test seed only. Refuses to run against production.
const USERS = [
  { name: "Josh Admin", email: "admin@rokket.test", role: "ADMIN" as const },
  { name: "Sam Staff", email: "staff@rokket.test", role: "STAFF" as const },
  { name: "Casey Client", email: "client@rokket.test", role: "CLIENT" as const },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set SEED_PASSWORD (min 12 chars) in .env.local.");
  const hash = await hashPassword(password);

  for (const u of USERS) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, active: true },
      create: { name: u.name, email: u.email, role: u.role, emailVerified: true },
    });
    const existing = await db.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
    if (existing) await db.account.update({ where: { id: existing.id }, data: { password: hash } });
    else
      await db.account.create({
        data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
      });
  }
  await db.setting.upsert({
    where: { key: "defaultTaxRateBps" },
    update: {},
    create: { key: "defaultTaxRateBps", value: 0 },
  });
  console.info(`Seeded ${USERS.length} users: ${USERS.map((u) => u.email).join(", ")}`);
}

main().finally(() => db.$disconnect());
