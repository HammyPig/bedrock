import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { todayIsoDate } from "~/lib/dates";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { CUSTOMERS, seedCustomer } from "../support/fixtures";
import {
  customerDetailsField,
  customerDetailsSection,
  deliveryCheckbox,
  documentType,
  fillMinimalInvoice,
  gotoNewInvoice,
  saveInvoice,
  saveStatus,
  totalsAmount,
  totalsPanel,
} from "../support/invoice-page";
import { verified } from "../support/verified";
import { fillTotalsExample, invoiceFormTests, savedInvoices } from "./invoice-form.shared";

test.beforeEach(async () => {
  await resetBusinessData();
});

// Everything a new invoice shares with an edit; the rest of this file is what only a new invoice does.
invoiceFormTests({
  name: "/invoices/new",
  open: gotoNewInvoice,
  // Without the wait, the next navigation can race the redirect and reload /invoices/new instead.
  saved: (page) => page.waitForURL(/\/invoices\/[^/]+\/edit$/),
  verified,
});

test.describe("customer section", verified("2026-09-13"), () => {
  /**
   * Every invoice has a customer, so assigning one is the first thing the form
   * asks for. It is done through a search: either an existing customer is clicked
   * or a new one is deliberately chosen.
   */
  test("opens as a search and nothing else", async ({ page }) => {
    await gotoNewInvoice(page);

    const picker = customerDetailsSection(page).getByRole("combobox");
    await expect(picker).toBeVisible();
    await expect(picker).toHaveText("Search customers...");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(customerDetailsField(page, "Name")).toBeHidden();
    await expect(deliveryCheckbox(page)).toBeHidden();
  });
});

test.describe("invoice metadata section", verified("2026-09-13"), () => {
  test("a new invoice is issued today", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(page.getByLabel("Issue date")).toHaveValue(todayIsoDate());
  });

  test("can be switched to a quote and back", async ({ page }) => {
    await gotoNewInvoice(page);

    await documentType(page).getByRole("button", { name: "Quote" }).click();
    await expect(page.getByRole("heading", { name: "New quote" })).toBeVisible();

    await documentType(page).getByRole("button", { name: "Invoice" }).click();
    await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  });
});

test.describe("balance section", verified("2026-09-14"), () => {
  test("GST only shows for a business registered for GST", async ({ page }) => {
    await gotoNewInvoice(page);
    await fillTotalsExample(page);
    await expect(totalsPanel(page).getByText("Includes GST (10%)")).toBeVisible();

    // Settings outlive the per-test reset, so registration is put back even if this fails.
    const testBusiness = eq(schema.businessSettings.businessId, TEST_BUSINESS_ID);
    await testDb.update(schema.businessSettings).set({ gstRegistered: false }).where(testBusiness);
    try {
      await gotoNewInvoice(page);
      await fillTotalsExample(page);
      await expect(totalsPanel(page).getByText(/GST/)).toBeHidden();
      await expect(totalsAmount(page, "Total")).toHaveText("$170.00");
    } finally {
      await testDb.update(schema.businessSettings).set({ gstRegistered: true }).where(testBusiness);
    }
  });
});

test.describe("the action bar", verified("2026-09-14"), () => {
  test("a new invoice is a draft", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("saving is refused if no customer is assigned", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Line 1 name").fill("Callout fee");

    await saveInvoice(page).click();
    await expect(saveStatus(page)).toHaveText("Fix the field above");
    await expect(page.getByText("Select a customer to bill.")).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/new$/);
    expect(await savedInvoices()).toEqual([]);
  });

  test("saving a new invoice creates it and opens it", async ({ page }) => {
    const customer = await seedCustomer(CUSTOMERS.acme);
    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);

    await saveInvoice(page).click();
    await page.waitForURL(/\/invoices\/[^/]+\/edit$/);

    const invoices = await savedInvoices();
    expect(invoices).toMatchObject([{ customerId: customer.id }]);
    expect(page.url()).toMatch(new RegExp(`/invoices/${invoices[0]?.id}/edit$`));
    await expect(page.getByLabel("Line 1 name")).toHaveValue("Callout fee");
  });
});
