import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, E2E_PORT, STORAGE_STATE, TEST_DATABASE_URL } from "./e2e/support/env";

/**
 * The unit project needs neither a browser nor Postgres, so `bun run e2e:unit`
 * sets this to skip starting Next.js — otherwise a sub-second suite waits on a
 * cold dev server. Set explicitly rather than sniffed from argv, which would
 * miss `--project unit` written with a space.
 */
const unitOnly = process.env.E2E_UNIT_ONLY === "1";

export default defineConfig({
  testDir: "./e2e",
  // Browser tests share one seeded business, so they mutate the same rows.
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
    // Pure functions: no browser, no database, no seeded session. Kept in this
    // config so `bun run e2e` still runs everything in one command.
    {
      name: "unit",
      testMatch: /unit\/.*\.spec\.ts/,
      fullyParallel: true,
    },
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
      // Scoped to tests/ so the unit specs don't also run here, against a
      // browser and a seeded database they have no use for.
      testMatch: /tests\/.*\.spec\.ts/,
    },
  ],
  webServer: unitOnly
    ? undefined
    : {
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
          // Emphatically not the real Resend credentials: a test must never be able
          // to send mail to a real address. Empty reads as unset (env.js treats
          // empty strings as undefined), and being set at all stops .env supplying
          // the real ones.
          RESEND_API_KEY: "",
          EMAIL_FROM: "",
        },
      },
});
