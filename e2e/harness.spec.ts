import { expect, test } from "@playwright/test";

import * as schema from "~/server/db/schema";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "./support/db";

const EMPTY_ADDRESS = { line1: "", line2: "", suburb: "", state: "", postcode: "" };

test.beforeEach(async () => {
  await resetBusinessData();
});

test("the seeded session lands on invoices without signing in", async ({ page }) => {
  await page.goto("/invoices");

  // Both redirects in the page guard stayed put: /login means the session
  // cookie didn't take, / means the business membership didn't resolve. The
  // heading renders below a useSuspenseQuery, so reaching it also proves the
  // tRPC query resolved against the e2e database.
  await expect(page).toHaveURL("/invoices");
  await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
});

test("resetBusinessData clears the business's data", async ({ page }) => {
  await testDb.insert(schema.customers).values({
    businessId: TEST_BUSINESS_ID,
    name: "Reset Probe",
    company: "Reset Probe Pty Ltd",
    phone: "",
    email: "",
    billingAddress: EMPTY_ADDRESS,
    deliveryAddress: EMPTY_ADDRESS,
  });

  await page.goto("/customers");
  await expect(page.getByText("Reset Probe Pty Ltd")).toBeVisible();

  // Every test relies on this in beforeEach; if it stops clearing rows, tests
  // start inheriting each other's data and fail in order-dependent ways.
  await resetBusinessData();
  await page.reload();
  await expect(page.getByText("No customers yet. Add your first customer.")).toBeVisible();
});
