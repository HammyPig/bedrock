import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { formatIsoDate } from "~/lib/dates";
import { resetBusinessData, testDb } from "../support/db";
import { billTo, draft, line } from "../support/drafts";
import { CUSTOMERS, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  addressInput,
  balanceDue,
  billToField,
  billToSection,
  deliveryCheckbox,
  dueDateText,
  editedMenu,
  fillAndCommit,
  fillMinimalInvoice,
  gotoNewInvoice,
  lineNames,
  lineSubtotal,
  pickCustomer,
  replaceText,
  saveInvoice,
  saveNewInvoice,
  saveStatus,
  setTerms,
  totalsAmount,
  totalsPanel,
} from "../support/invoice-page";

/**
 * P1-P6. An invoice is only worth entering if it comes back the same, so this
 * is the tier of the suite where a failure is always a bug rather than a change
 * of mind.
 */

test.beforeEach(async () => {
  await resetBusinessData();
});

test("P1 a saved invoice appears in the list", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await fillMinimalInvoice(page, /Priya Nair/);
  await saveNewInvoice(page);

  await page.goto("/invoices");
  const row = page.getByRole("row", { name: /INV-1001/ });
  await expect(row).toContainText("Priya Nair");
  await expect(row).toContainText("$165.00"); // $150.00 plus 10% GST
});

test("P2 everything entered comes back the same", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);

  await pickCustomer(page, /Priya Nair/);
  await deliveryCheckbox(page).check();
  // Spelled out rather than left to the default: which address delivery starts
  // on is C17's to specify, and this test is about what survives a round trip.
  await billToSection(page).getByRole("button", { name: "Use different address" }).click();
  await replaceText(page.getByLabel("Invoice no."), "INV-2201");
  await page.getByLabel("Issue date").fill("2026-03-15");
  await setTerms(page, "Net 14");

  await page.getByRole("button", { name: "Discounts" }).click();
  await page.getByLabel("Line 1 name").fill("Copper pipe");
  await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "42.50");
  await fillAndCommit(page.getByLabel("Line 1 discount percent"), "10");

  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Line 2 name").fill("Labour");
  await fillAndCommit(page.getByLabel("Line 2 quantity"), "2");
  await fillAndCommit(page.getByLabel("Line 2 unit price"), "120");
  await page.getByRole("button", { name: "Backorders" }).click();
  await page.getByRole("checkbox", { name: "Line 2 backordered" }).check();

  await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
  await totalsPanel(page).getByRole("button", { name: "$", exact: true }).click();
  await fillAndCommit(page.getByLabel("Discount amount"), "25");
  await fillAndCommit(page.getByLabel("Freight"), "15");
  await page.getByLabel("Notes").fill("Backordered items to follow.");

  await saveNewInvoice(page);
  await page.reload();

  await expect(billToField(page, "Name")).toHaveValue("Priya Nair");
  await expect(deliveryCheckbox(page)).toBeChecked();
  await expect(addressInput(page, "Delivery")).toHaveValue("88 Depot Lane, Alexandria NSW 2015");

  await expect(page.getByLabel("Invoice no.")).toHaveValue("INV-2201");
  await expect(page.getByLabel("Issue date")).toHaveValue("2026-03-15");
  await expect(dueDateText(page)).toHaveText(formatIsoDate("2026-03-29"));

  expect(await lineNames(page)).toEqual(["Copper pipe", "Labour"]);
  await expect(page.getByLabel("Line 1 quantity")).toHaveValue("3");
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$42.50");
  await expect(page.getByLabel("Line 1 discount percent")).toHaveValue("10");
  await expect(lineSubtotal(page, 1)).toHaveText("$114.75");
  await expect(lineSubtotal(page, 2)).toHaveText("$240.00");
  await expect(page.getByRole("checkbox", { name: "Line 2 backordered" })).toBeChecked();

  await expect(totalsAmount(page, "Subtotal")).toHaveText("$354.75");
  await expect(totalsAmount(page, "Discount")).toHaveText("-$25.00");
  await expect(page.getByLabel("Freight")).toHaveValue("$15.00");
  await expect(totalsAmount(page, "GST")).toHaveText("$34.48");
  await expect(balanceDue(page)).toHaveText("$379.23");
  await expect(page.getByLabel("Notes")).toHaveValue("Backordered items to follow.");
});

test("P3 an edit replaces what was there before", async ({ page }) => {
  const invoice = await seedInvoice(
    draft({ invoiceNumber: "INV-0900", lineItems: [line({ name: "Original" })] }),
  );
  await page.goto(`/invoices/${invoice.id}/edit`);

  await replaceText(page.getByLabel("Line 1 name"), "Replaced");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "250");
  await page.getByLabel("Notes").fill("Revised after the site visit.");
  await saveInvoice(page).click();
  await expect(saveStatus(page)).toHaveText("Saved");

  await page.reload();
  expect(await lineNames(page)).toEqual(["Replaced"]);
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$250.00");
  await expect(page.getByLabel("Notes")).toHaveValue("Revised after the site visit.");
  await expect(balanceDue(page)).toHaveText("$275.00");
});

test("P4 changing a customer leaves invoices already sent alone", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);

  await gotoNewInvoice(page);
  await fillMinimalInvoice(page, /Priya Nair/);
  await saveNewInvoice(page);
  const firstInvoice = page.url();

  // A later invoice edits the customer, which writes through to their record.
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await replaceText(billToField(page, "Phone"), "02 9333 4444");
  await editedMenu(page).click();
  await page.getByRole("menuitem", { name: "Update saved customer" }).click();
  await expect(billToField(page, "Phone")).toHaveValue("02 9333 4444");

  // The invoice already issued keeps the details it was issued with.
  await page.goto(firstInvoice);
  await expect(billToField(page, "Phone")).toHaveValue("02 9111 2222");
});

test("P5 an invoice outlives the customer it was billed to", async ({ page }) => {
  const customer = await seedCustomer(CUSTOMERS.acme);
  const invoice = await seedInvoice(
    draft({
      invoiceNumber: "INV-0900",
      sourceCustomerId: customer.id,
      billTo: billTo({ name: "Priya Nair", company: "Acme Constructions", phone: "02 9111 2222" }),
      lineItems: [line()],
    }),
  );

  await testDb.delete(schema.customers).where(eq(schema.customers.id, customer.id));

  await page.goto(`/invoices/${invoice.id}/edit`);
  await expect(billToField(page, "Name")).toHaveValue("Priya Nair");
  await expect(billToField(page, "Phone")).toHaveValue("02 9111 2222");
  await expect(balanceDue(page)).toHaveText("$110.00");
});

test("P6 the order of the lines is part of the invoice", async ({ page }) => {
  test.fixme();
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await page.getByLabel("Line 1 name").fill("First");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Line 2 name").fill("Second");
  await page.getByRole("button", { name: "Move line 2 up" }).click();

  await saveNewInvoice(page);
  await page.reload();
  expect(await lineNames(page)).toEqual(["Second", "First"]);
});
