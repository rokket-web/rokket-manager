import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests hit a real database (DATABASE_URL). Use the Dev or a CI branch, never production.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/empty.ts") } },
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    setupFiles: ["tests/load-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
