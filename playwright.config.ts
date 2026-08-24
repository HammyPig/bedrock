import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, E2E_PORT, STORAGE_STATE, TEST_DATABASE_URL } from "./e2e/support/env";

export default defineConfig({
  testDir: "./e2e",
  // Tests share one seeded business, so they mutate the same rows.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
      testMatch: /.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    // Safe to reuse: this port only ever serves the e2e database, so a warm
    // server from a previous run saves the Next.js startup on every run.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    env: {
      E2E: "true",
      PORT: String(E2E_PORT),
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
