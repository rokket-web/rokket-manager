import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
if (/ep-late-recipe/.test(process.env.DATABASE_URL ?? ""))
  throw new Error("Refusing to run integration tests against production.");
