import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "~/server/db/schema";
import { TEST_DATABASE_URL } from "./env";

/**
 * The tenant every test runs as. Fixed ids keep the seeded session cookie
 * stable across runs, so `storageState` never has to be regenerated.
 */
export const TEST_USER = {
  id: "e2e-user",
  name: "Test Owner",
  email: "owner@e2e.test",
} as const;

export const TEST_BUSINESS_ID = "e2e-business";
export const SESSION_TOKEN = "e2e-session-token";

const client = postgres(TEST_DATABASE_URL);
export const testDb = drizzle(client, { schema });

/** Tables holding the tenant itself — cleared on a full reset, never between tests. */
const TENANT_TABLES = [
  "bedrock_user",
  "bedrock_account",
  "bedrock_session",
  "bedrock_verification_token",
  "bedrock_business",
  "bedrock_business_user",
  "bedrock_business_settings",
];

async function truncate(tables: string[]) {
  if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
    throw new Error(
      `Refusing to truncate ${TEST_DATABASE_URL} — the e2e database must end in _test.`,
    );
  }
  if (tables.length === 0) return;
  await client`TRUNCATE TABLE ${client(tables)} RESTART IDENTITY CASCADE`;
}

async function allTables() {
  const rows = await client<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'bedrock_%'
  `;
  return rows.map((row) => row.name);
}

/**
 * Clears invoices, customers, items and the rest of the business's data while
 * leaving the signed-in user and their business in place. Call this from a
 * `beforeEach` so tests don't inherit rows from whatever ran before them.
 */
export async function resetBusinessData() {
  const tables = await allTables();
  await truncate(tables.filter((name) => !TENANT_TABLES.includes(name)));
}

/** Wipes everything and rebuilds the tenant plus its logged-in session. */
export async function resetAndSeed() {
  await truncate(await allTables());

  await testDb.insert(schema.users).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
    emailVerified: new Date(),
  });

  await testDb.insert(schema.businesses).values({
    id: TEST_BUSINESS_ID,
    ownerUserId: TEST_USER.id,
  });

  await testDb.insert(schema.businessUsers).values({
    userId: TEST_USER.id,
    businessId: TEST_BUSINESS_ID,
  });

  await testDb.insert(schema.businessSettings).values({
    businessId: TEST_BUSINESS_ID,
    businessName: "Test Plumbing Co",
    taxId: "12 345 678 901",
    address: {
      line1: "1 Test Street",
      line2: "",
      suburb: "Sydney",
      state: "NSW",
      postcode: "2000",
    },
    website: "https://test-plumbing.example",
    email: "accounts@test-plumbing.example",
    phone: "02 9000 0000",
    paymentDetails: "BSB 000-000\nAccount 12345678",
    termsAndConditions: "Payment due within 14 days.",
    invoiceNumberPrefix: "INV-",
    nextInvoiceNumber: "1001",
  });

  // A database session, so the cookie below is all it takes to be signed in.
  await testDb.insert(schema.sessions).values({
    sessionToken: SESSION_TOKEN,
    userId: TEST_USER.id,
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

export async function closeTestDb() {
  await client.end();
}
