import { defineConfig } from "@playwright/test";

const port = 3100;
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: process.env.CI ? `npx next start -p ${port}` : `npx next dev -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
