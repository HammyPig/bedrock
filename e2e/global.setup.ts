import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { test as setup } from "@playwright/test";
import postgres from "postgres";

import { closeTestDb, resetAndSeed, SESSION_TOKEN } from "./support/db";
import { STORAGE_STATE, TEST_DATABASE_URL } from "./support/env";

/**
 * Creates the e2e database on first run; a no-op afterwards. `bun run e2e:fresh`
 * drops it first, which is the fix if a schema change ever fails to reach it —
 * see pushSchema below.
 */
async function ensureDatabase() {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to create database "${name}".`);

  url.pathname = "/postgres";
  const admin = postgres(url.toString());
  try {
    // No bind parameters in CREATE/DROP DATABASE, and `name` comes from our own
    // DATABASE_URL rather than test input. FORCE evicts the dev server's pool.
    if (process.env.E2E_FRESH_DB)
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);

    const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!existing) await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

/**
 * Brings the e2e database up to the current schema. Cheap when nothing has
 * changed, which means schema edits need no separate step before running tests.
 *
 * The target comes from DATABASE_URL rather than `--url`, because passing any
 * CLI option makes drizzle-kit ignore drizzle.config.ts and with it the schema
 * path and `bedrock_*` filter.
 */
function pushSchema() {
  try {
    execFileSync("bunx", ["drizzle-kit", "push", "--force"], {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SKIP_ENV_VALIDATION: "1" },
    });
  } catch (error) {
    // drizzle-kit 0.30 emits phantom `DROP CONSTRAINT <col>_not_null` statements
    // on every re-push and Postgres rejects them on primary keys. Harmless, but
    // it means a genuine schema change can be skipped — rerun with
    // `bun run e2e:fresh` to rebuild the database from scratch.
    const output =
      error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(`drizzle-kit push failed. Try \`bun run e2e:fresh\`.\n\n${output}`);
  }
}

/**
 * Google OAuth can't be driven from a browser test, but sessions are database
 * rows (`DrizzleAdapter` with no `strategy` override), so the session cookie
 * holds the token verbatim. Writing the seeded token into Playwright's storage
 * state is enough to start every test signed in.
 */
function writeStorageState() {
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  fs.writeFileSync(
    STORAGE_STATE,
    JSON.stringify(
      {
        cookies: [
          {
            name: "authjs.session-token",
            value: SESSION_TOKEN,
            domain: "localhost",
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
  );
}

setup("prepare the e2e database and signed-in state", async () => {
  setup.setTimeout(120_000);

  await ensureDatabase();
  pushSchema();
  await resetAndSeed();
  writeStorageState();
  await closeTestDb();
});
