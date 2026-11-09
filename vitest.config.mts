import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], exclude: ["**/*.int.test.ts", "node_modules/**"], environment: "node" },
});
