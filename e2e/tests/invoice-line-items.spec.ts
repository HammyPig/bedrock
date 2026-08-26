import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { draft, line } from "../support/drafts";
import { ITEMS, seedCatalog, seedInvoice } from "../support/fixtures";
import { fillAndCommit, gotoNewInvoice, lineNames, lineSubtotal } from "../support/invoice-page";

/**
 * L1-L13. The grid an invoice is actually built in: free-text lines, catalog
 * lookups that never write back, and the two opt-in columns.
 */

test.beforeEach(async () => {
  await resetBusinessData();
});

test("L1 a line can be anything, catalog or not", async ({ page }) => {
  await seedCatalog();
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 name").fill("Emergency callout, after hours");
  await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "185");

  await expect(page.getByLabel("Line 1 name")).toHaveValue("Emergency callout, after hours");
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$185.00");
  await expect(lineSubtotal(page, 1)).toHaveText("$370.00");
});

test("L2 a SKU finds its catalog item", async ({ page }) => {
  await seedCatalog();
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 SKU").fill("PIPE-100");

  // Both SKUs start with what was typed; the lookup offers both rather than guessing.
  await expect(page.getByRole("button", { name: /Copper pipe 100mm/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copper pipe 1000mm/ })).toBeVisible();

  await page.getByRole("button", { name: /Copper pipe 100mm/ }).click();
  await expect(page.getByLabel("Line 1 SKU")).toHaveValue("PIPE-100");
  await expect(page.getByLabel("Line 1 name")).toHaveValue("Copper pipe 100mm");
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$42.50");
});

test("L3 the same lookup works from the name", async ({ page }) => {
  await seedCatalog();
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 name").fill("Labour");
  await page.getByRole("button", { name: /Labour \(per hour\)/ }).click();

  await expect(page.getByLabel("Line 1 SKU")).toHaveValue("LAB-HR");
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$120.00");
});

test("L4 changing a line never edits the catalog item", async ({ page }) => {
  await seedCatalog();
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 SKU").fill("LAB-HR");
  await page.getByRole("button", { name: /Labour \(per hour\)/ }).click();

  await page.getByLabel("Line 1 name").fill("Labour, weekend rate");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "180");
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$180.00");

  const items = await testDb.query.items.findMany({
    where: eq(schema.items.businessId, TEST_BUSINESS_ID),
  });
  expect(items.find((item) => item.sku === "LAB-HR")).toMatchObject({
    name: ITEMS.labour.name,
    unitPriceCents: ITEMS.labour.unitPriceCents,
  });
});

test("L5 the line subtotal follows quantity and price", async ({ page }) => {
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 name").fill("Copper pipe");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "10.50");
  await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
  await expect(lineSubtotal(page, 1)).toHaveText("$31.50");

  await fillAndCommit(page.getByLabel("Line 1 quantity"), "4");
  await expect(lineSubtotal(page, 1)).toHaveText("$42.00");
});

test("L6 a new line is added ready to type into", async ({ page }) => {
  await gotoNewInvoice(page);

  await page.getByRole("button", { name: "Add item" }).click();

  await expect(page.getByLabel("Line 2 SKU")).toBeVisible();
  await expect(page.getByLabel("Line 2 SKU")).toBeFocused();
});

test("L7 a line can be removed", async ({ page }) => {
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 name").fill("First");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Line 2 name").fill("Second");

  await page.getByRole("button", { name: "Remove line 1" }).click();

  expect(await lineNames(page)).toEqual(["Second"]);
});

test("L8 the last line cannot be removed", async ({ page }) => {
  await gotoNewInvoice(page);

  // An invoice always has somewhere to type, so the final row stays put.
  await expect(page.getByRole("button", { name: "Remove line 1" })).toBeDisabled();

  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("button", { name: "Remove line 1" })).toBeEnabled();
});

test("L9 discounts are an opt-in column", async ({ page }) => {
  await gotoNewInvoice(page);

  await expect(page.getByLabel("Line 1 discount percent")).toBeHidden();

  await page.getByRole("button", { name: "Discounts" }).click();
  await expect(page.getByLabel("Line 1 discount percent")).toBeVisible();

  await page.getByRole("button", { name: "Discounts" }).click();
  await expect(page.getByLabel("Line 1 discount percent")).toBeHidden();
});

test("L10 backorders are an opt-in column", async ({ page }) => {
  await gotoNewInvoice(page);

  await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeHidden();

  await page.getByRole("button", { name: "Backorders" }).click();
  await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeVisible();
});

test.describe("L11 a column an invoice already uses starts open", () => {
  test("a discounted line shows the discount column", async ({ page }) => {
    const invoice = await seedInvoice(
      draft({ lineItems: [line({ name: "Discounted", discountPercent: 10 })] }),
    );
    await page.goto(`/invoices/${invoice.id}/edit`);

    // Saved data must never be hidden behind a toggle.
    await expect(page.getByLabel("Line 1 discount percent")).toHaveValue("10");
    await expect(page.getByRole("button", { name: "Discounts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a backordered line shows the backorder column", async ({ page }) => {
    const invoice = await seedInvoice(
      draft({ lineItems: [line({ name: "On order", backordered: true })] }),
    );
    await page.goto(`/invoices/${invoice.id}/edit`);

    await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeChecked();
  });
});

test("L12 a column in use says why it will not close", async ({ page }) => {
  test.fixme();
  const invoice = await seedInvoice(
    draft({ lineItems: [line({ name: "Discounted", discountPercent: 10 })] }),
  );
  await page.goto(`/invoices/${invoice.id}/edit`);

  await page.getByRole("button", { name: "Discounts" }).click();
  await expect(page.getByText("Clear the discounts on each line first.")).toBeVisible();
  await expect(page.getByLabel("Line 1 discount percent")).toBeVisible();
});

test("L13 a line can be moved up and down", async ({ page }) => {
  test.fixme();
  await gotoNewInvoice(page);

  await page.getByLabel("Line 1 name").fill("First");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Line 2 name").fill("Second");

  await page.getByRole("button", { name: "Move line 2 up" }).click();
  expect(await lineNames(page)).toEqual(["Second", "First"]);

  await page.getByRole("button", { name: "Move line 1 down" }).click();
  expect(await lineNames(page)).toEqual(["First", "Second"]);
});
