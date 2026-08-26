import { expect, test } from "@playwright/test";

import { addDaysIso, formatIsoDate, todayIsoDate } from "~/lib/dates";
import { resetBusinessData } from "../support/db";
import { draft, line } from "../support/drafts";
import { CUSTOMERS, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  documentType,
  dueDateText,
  fillMinimalInvoice,
  gotoNewInvoice,
  replaceText,
  saveInvoice,
  saveNewInvoice,
  saveStatus,
  setTerms,
} from "../support/invoice-page";

/**
 * Mt1-Mt9 and Dt1-Dt5. The numbering and dating of the document, and whether it
 * is an invoice or a quote.
 */

test.beforeEach(async () => {
  await resetBusinessData();
});

test("Mt1 a new invoice is issued today", async ({ page }) => {
  await gotoNewInvoice(page);
  await expect(page.getByLabel("Issue date")).toHaveValue(todayIsoDate());
});

test("Mt2 the invoice number follows the business's numbering", async ({ page }) => {
  await gotoNewInvoice(page);
  // The seeded business is on prefix "INV-" from 1001.
  await expect(page.getByLabel("Invoice no.")).toHaveValue("INV-1001");
});

test.describe("Mt3 the terms decide the due date", () => {
  const cases = [
    { terms: "Due on receipt", days: 0 },
    { terms: "Net 7", days: 7 },
    { terms: "Net 14", days: 14 },
    { terms: "Net 30", days: 30 },
  ];

  for (const { terms, days } of cases) {
    test(`${terms} is due ${days} days after issue`, async ({ page }) => {
      await gotoNewInvoice(page);
      await setTerms(page, terms);
      await expect(dueDateText(page)).toHaveText(formatIsoDate(addDaysIso(todayIsoDate(), days)));
    });
  }
});

test("Mt4 custom terms hand the due date over to be set", async ({ page }) => {
  await gotoNewInvoice(page);

  // Until then it is derived, and shown as text rather than a field.
  await expect(dueDateText(page)).toBeVisible();

  await setTerms(page, "Custom");
  await page.getByLabel("Due date").fill("2026-12-01");
  await expect(page.getByLabel("Due date")).toHaveValue("2026-12-01");
});

test("Mt5 changing the issue date moves the due date with it", async ({ page }) => {
  await gotoNewInvoice(page);
  await setTerms(page, "Net 7");
  await page.getByLabel("Issue date").fill("2026-01-31");

  await expect(dueDateText(page)).toHaveText(formatIsoDate("2026-02-07"));
});

test("Mt6 reusing an invoice number is called out while it is typed", async ({ page }) => {
  test.fixme();
  await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  await gotoNewInvoice(page);

  await replaceText(page.getByLabel("Invoice no."), "INV-0900");
  await expect(page.getByText("Invoice number INV-0900 already exists.")).toBeVisible();
});

test("Mt7 the warning goes once the number is free again", async ({ page }) => {
  test.fixme();
  await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  await gotoNewInvoice(page);

  const number = page.getByLabel("Invoice no.");
  await replaceText(number, "INV-0900");
  await expect(page.getByText("Invoice number INV-0900 already exists.")).toBeVisible();

  await replaceText(number, "INV-0901");
  await expect(page.getByText(/already exists/)).toBeHidden();
});

test("Mt8 an invoice is not warned about its own number", async ({ page }) => {
  test.fixme();
  const invoice = await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  await page.goto(`/invoices/${invoice.id}/edit`);

  await replaceText(page.getByLabel("Invoice no."), "INV-0900");
  await expect(page.getByText(/already exists/)).toBeHidden();
});

test("Mt9 an invoice number already in use is refused on save", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  await gotoNewInvoice(page);

  await fillMinimalInvoice(page, /Priya Nair/);
  await replaceText(page.getByLabel("Invoice no."), "INV-0900");
  await saveInvoice(page).click();

  await expect(saveStatus(page)).toHaveText("Invoice number INV-0900 already exists.");
});

test("Dt1 the document can be issued as a quote instead", async ({ page }) => {
  await gotoNewInvoice(page);
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();

  await documentType(page).getByRole("button", { name: "Quote" }).click();
  await expect(page.getByRole("heading", { name: "New quote" })).toBeVisible();
});

test("Dt2 a quote asks for a quote number", async ({ page }) => {
  await gotoNewInvoice(page);
  await expect(page.getByLabel("Invoice no.")).toBeVisible();

  await documentType(page).getByRole("button", { name: "Quote" }).click();
  await expect(page.getByLabel("Quote no.")).toHaveValue("INV-1001");
  await expect(page.getByLabel("Invoice no.")).toBeHidden();
});

test("Dt3 a quote is not payable", async ({ page }) => {
  const quote = await seedInvoice(draft({ documentType: "quote", invoiceNumber: "QUO-0001" }));
  const invoice = await seedInvoice(draft({ invoiceNumber: "INV-0900" }));

  await page.goto(`/invoices/${quote.id}/edit`);
  await expect(page.getByRole("button", { name: "Record full payment" })).toBeHidden();

  // The same document as an invoice does offer it, so this is the type talking.
  await page.goto(`/invoices/${invoice.id}/edit`);
  await expect(page.getByRole("button", { name: "Record full payment" })).toBeVisible();
});

test("Dt4 the document type survives a save", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);

  await fillMinimalInvoice(page, /Priya Nair/);
  await documentType(page).getByRole("button", { name: "Quote" }).click();
  await saveNewInvoice(page);
  await expect(saveStatus(page)).toHaveText("Saved");

  await page.reload();
  await expect(page.getByLabel("Quote no.")).toBeVisible();
});

test("Dt5 a saved quote can become an invoice", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  const quote = await seedInvoice(
    draft({ documentType: "quote", invoiceNumber: "QUO-0001", lineItems: [line()] }),
  );

  await page.goto(`/invoices/${quote.id}/edit`);
  await documentType(page).getByRole("button", { name: "Invoice" }).click();
  await saveInvoice(page).click();
  await expect(saveStatus(page)).toHaveText("Saved");

  await page.reload();
  await expect(page.getByLabel("Invoice no.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record full payment" })).toBeVisible();
});
