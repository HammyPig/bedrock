import path from "node:path";

/**
 * Playwright has no equivalent of Next.js's automatic `.env` loading, so the
 * config and the setup project read it themselves. Already-set variables win,
 * which is what lets CI supply DATABASE_URL without a file on disk.
 */
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // No .env on disk — fall back to whatever is already in the environment.
}

/**
 * Deliberately not the dev server's port: Conductor workspaces run that on
 * $CONDUCTOR_PORT against the shared dev database, and a suite that reused it
 * would truncate real data.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://localhost:${E2E_PORT}`;

export const STORAGE_STATE = path.join(process.cwd(), "e2e/.auth/state.json");

/**
 * The e2e database is a sibling of the dev one in the same Postgres container
 * — `bedrock` becomes `bedrock_test`. Every Conductor workspace shares one
 * container, so pointing the suite anywhere else would let it wipe a database
 * another branch is using.
 */
export const TEST_DATABASE_URL = (() => {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) throw new Error("DATABASE_URL is not set — copy .env.example to .env.");

  const url = new URL(devUrl);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
})();
