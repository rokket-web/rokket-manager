import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { defineConfig } from "prisma/config";

// Migrations and the Prisma CLI use the DIRECT (non-pooled) Neon connection.
// The app at runtime uses DATABASE_URL (pooled) via src/server/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DIRECT_URL ?? "" },
});
