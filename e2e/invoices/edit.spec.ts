import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { type InvoiceDraft } from "~/app/invoices/_lib/types";
import { formatIsoDate } from "~/lib/dates";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { customerDetails, draft, line } from "../support/drafts";
import { CUSTOMERS, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  actionBar,
  addressInput,
  customerDetailsField,
  customerDetailsSection,
  deliveryCheckbox,
  documentType,
  dueDateText,
  editedMenu,
  gotoEditInvoice,
  lineNames,
  lineSubtotal,
  replaceText,
  saveInvoice,
  saveStatus,
  totalsAmount,
  updateCustomerPrompt,
} from "../support/invoice-page";
import { pdfText } from "../support/pdf";
import { verified } from "../support/verified";
import { invoiceFormTests, savedInvoices } from "./invoice-form.shared";

test.beforeEach(async () => {
  await resetBusinessData();
});

function savedInvoice(id: string) {
  return testDb.query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
}

/**
 * What the shared tests edit: billed to a customer none of them seed, with one
 * line that isn't in the catalog and nothing else filled in, so an edit starts
 * as close to a new invoice as a saved one can.
 */
async function plainInvoice() {
  const customer = await seedCustomer(customerDetails());
  return seedInvoice(draft({ customerId: customer.id, lineItems: [line({ name: "Site visit" })] }));
}

/** Every section filled in, billed to Acme exactly as their record has them. */
async function loadedInvoice(overrides: Partial<InvoiceDraft> = {}) {
  const customer = await seedCustomer(CUSTOMERS.acme);
  return seedInvoice(
    draft({
      invoiceNumber: "INV-0900",
      customerId: customer.id,
      customerDetails: customerDetails({
        name: "Priya Nair",
        company: "Acme Constructions",
        email: "priya@acme.example",
        phone: "02 9111 2222",
        billingAddress: CUSTOMERS.acme.billingAddress,
        deliveryAddress: CUSTOMERS.acme.deliveryAddress,
      }),
      hasDeliveryAddress: true,
      deliverySameAsBilling: false,
      lineItems: [
        line({
          sku: "PIPE-100",
          name: "Copper pipe 100mm",
          quantityMilli: 3000,
          unitPriceCents: 4250,
        }),
        line({
          sku: "LAB-HR",
          name: "Labour",
          quantityMilli: 2000,
          unitPriceCents: 12_000,
        }),
      ],
      discount: { basisPoints: 0, amountCents: 2500 },
      deliveryCents: 1500,
      deliveryTaxBasisPoints: 1000,
      notes: "Please pay by bank transfer.",
      ...overrides,
    }),
  );
}

// Everything an edit shares with a new invoice; the rest of this file is what only an edit does.
invoiceFormTests({
  name: "/invoices/[id]/edit",
  open: async (page) => gotoEditInvoice(page, await plainInvoice()),
  saved: (page) => expect(saveStatus(page)).toHaveText("Saved"),
  // Not yet checked by a human on this route; see Tests in .claude/CLAUDE.md.
  verified: () => ({}),
});

test.describe("opening a saved invoice", () => {
  test("is headed by its number", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());
    await expect(page.getByRole("heading", { name: "Edit INV-0900" })).toBeVisible();
  });

  test("shows who it was billed to", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());

    await expect(customerDetailsSection(page).getByRole("combobox")).toHaveText("Priya Nair");
    await expect(customerDetailsField(page, "Name")).toHaveValue("Priya Nair");
    await expect(customerDetailsField(page, "Company")).toHaveValue("Acme Constructions");
    await expect(customerDetailsField(page, "Phone")).toHaveValue("02 9111 2222");
    await expect(customerDetailsField(page, "Email")).toHaveValue("priya@acme.example");
    await expect(addressInput(page, "Billing")).toHaveValue(
      "14 Wharf Road, Level 3, Pyrmont NSW 2009",
    );
    await expect(deliveryCheckbox(page)).toBeChecked();
    await expect(addressInput(page, "Delivery")).toHaveValue("88 Depot Lane, Alexandria NSW 2015");
    await expect(editedMenu(page)).toBeHidden();
  });

  test("shows its number, dates and terms", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());

    await expect(page.getByLabel("Invoice no.")).toHaveValue("INV-0900");
    await expect(page.getByLabel("Issue date")).toHaveValue("2026-08-26");
    await expect(page.getByLabel("Terms")).toHaveText("Net 30");
    await expect(dueDateText(page)).toHaveText(formatIsoDate("2026-09-25"));
  });

  test("shows a quote on custom terms as one", async ({ page }) => {
    await gotoEditInvoice(
      page,
      await loadedInvoice({ isQuote: true, terms: "custom", customDueDate: "2026-12-01" }),
    );

    await expect(page.getByLabel("Quote no.")).toHaveValue("INV-0900");
    await expect(page.getByLabel("Terms")).toHaveText("Custom");
    await expect(page.getByLabel("Due date")).toHaveValue("2026-12-01");
  });

  test("shows its lines in order", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());

    expect(await lineNames(page)).toEqual(["Copper pipe 100mm", "Labour"]);
    await expect(page.getByLabel("Line 1 SKU")).toHaveValue("PIPE-100");
    await expect(page.getByLabel("Line 1 quantity")).toHaveValue("3");
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$42.50");
    await expect(lineSubtotal(page, 1)).toHaveText("$127.50");
    await expect(page.getByLabel("Line 2 SKU")).toHaveValue("LAB-HR");
    await expect(page.getByLabel("Line 2 quantity")).toHaveValue("2");
    await expect(page.getByLabel("Line 2 unit price")).toHaveValue("$120.00");
    await expect(lineSubtotal(page, 2)).toHaveText("$240.00");
  });

  test("shows its discount, delivery, notes and totals", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());

    await expect(page.getByLabel("Discount amount")).toHaveValue("25.00");
    await expect(page.getByLabel("Delivery", { exact: true })).toHaveValue("$15.00");
    await expect(page.getByLabel("Notes")).toHaveValue("Please pay by bank transfer.");
    await expect(totalsAmount(page, "Subtotal")).toHaveText("$367.50");
    await expect(totalsAmount(page, "Discount")).toHaveText("-$25.00");
    await expect(totalsAmount(page, "Total")).toHaveText("$357.50");
    await expect(totalsAmount(page, "Includes GST (10%)")).toHaveText("$32.50");
  });

  test("shows a percentage discount as a percentage", async ({ page }) => {
    await gotoEditInvoice(
      page,
      await loadedInvoice({ discount: { basisPoints: 1000, amountCents: 0 } }),
    );

    await expect(page.getByLabel("Discount percent")).toHaveValue("10");
    await expect(totalsAmount(page, "Discount")).toHaveText("-$36.75");
  });

  test("keeps the GST rate it was saved at after registration changes", async ({ page }) => {
    const invoice = await loadedInvoice();

    // Settings outlive the per-test reset, so registration is put back even if this fails.
    const testBusiness = eq(schema.businessSettings.businessId, TEST_BUSINESS_ID);
    await testDb.update(schema.businessSettings).set({ gstRegistered: false }).where(testBusiness);
    try {
      await gotoEditInvoice(page, invoice);
      await expect(totalsAmount(page, "Includes GST (10%)")).toHaveText("$32.50");
    } finally {
      await testDb.update(schema.businessSettings).set({ gstRegistered: true }).where(testBusiness);
    }
  });
});

test.describe("the invoice number", () => {
  test("can be changed", async ({ page }) => {
    const invoice = await loadedInvoice();
    await gotoEditInvoice(page, invoice);

    await replaceText(page.getByLabel("Invoice no."), "INV-0950");
    await saveInvoice(page).click();

    await expect(saveStatus(page)).toHaveText("Saved");
    expect(await savedInvoice(invoice.id)).toMatchObject({ invoiceNumber: "INV-0950" });
  });

  test("is required", async ({ page }) => {
    const invoice = await loadedInvoice();
    await gotoEditInvoice(page, invoice);

    await replaceText(page.getByLabel("Invoice no."), "");
    await saveInvoice(page).click();

    await expect(page.getByText("Invoice number is required.")).toBeVisible();
    await expect(page.getByLabel("Invoice no.")).toHaveAttribute("aria-invalid", "true");
    await expect(saveStatus(page)).toHaveText("Fix the field above");
    expect(await savedInvoice(invoice.id)).toMatchObject({ invoiceNumber: "INV-0900" });
  });

  test("is a quote number while it is a quote", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());
    await replaceText(page.getByLabel("Invoice no."), "");

    await documentType(page).getByRole("button", { name: "Quote" }).click();
    await saveInvoice(page).click();
    await expect(page.getByLabel("Quote no.")).toBeVisible();
    await expect(page.getByText("Quote number is required.")).toBeVisible();

    await documentType(page).getByRole("button", { name: "Invoice" }).click();
    await expect(page.getByLabel("Invoice no.")).toBeVisible();
    await expect(page.getByText("Invoice number is required.")).toBeVisible();
  });

  test("can't be one another invoice already has", async ({ page }) => {
    const invoice = await loadedInvoice();
    await seedInvoice(draft({ invoiceNumber: "INV-0901", customerId: invoice.customerId }));
    await gotoEditInvoice(page, invoice);

    const number = page.getByLabel("Invoice no.");
    await replaceText(number, "INV-0901");
    await saveInvoice(page).click();

    await expect(page.getByText("Invoice number INV-0901 already exists.")).toBeVisible();
    await expect(number).toHaveAttribute("aria-invalid", "true");
    await expect(saveStatus(page)).toHaveText("Fix the field above");
    expect(await savedInvoice(invoice.id)).toMatchObject({ invoiceNumber: "INV-0900" });

    await replaceText(number, "INV-0902");
    await expect(page.getByText("Invoice number INV-0901 already exists.")).toBeHidden();
    await expect(number).not.toHaveAttribute("aria-invalid", "true");
  });
});

/**
 * An invoice keeps the customer details it was saved with, so a later change to
 * the customer's record leaves the two differing. Where that difference belongs
 * was settled when the invoice was saved; re-asking about it on every save is
 * how people learn to dismiss the prompt without reading it.
 */
test.describe("when the customer's record has changed since the invoice was saved", () => {
  async function outdatedInvoice() {
    const invoice = await loadedInvoice();
    await testDb
      .update(schema.customers)
      .set({ phone: "02 9777 8888" })
      .where(eq(schema.customers.id, invoice.customerId));
    return invoice;
  }

  test("the invoice keeps its own details and shows they differ", async ({ page }) => {
    await gotoEditInvoice(page, await outdatedInvoice());

    await expect(customerDetailsField(page, "Phone")).toHaveValue("02 9111 2222");
    await expect(editedMenu(page)).toBeVisible();
  });

  test("saving only asks to update the customer once the details are edited", async ({ page }) => {
    await gotoEditInvoice(page, await outdatedInvoice());
    await page.getByLabel("Notes").fill("Paid in cash.");

    await saveInvoice(page).click();
    await expect(saveStatus(page)).toHaveText("Saved");
    await expect(updateCustomerPrompt(page)).toBeHidden();

    await replaceText(customerDetailsField(page, "Email"), "accounts@acme.example");
    await saveInvoice(page).click();
    await expect(updateCustomerPrompt(page)).toBeVisible();
  });
});

test.describe("the action bar", () => {
  test("a saved invoice opens saved, until it is edited", async ({ page }) => {
    await gotoEditInvoice(page, await loadedInvoice());
    await expect(saveStatus(page)).toHaveText("Saved");

    await page.getByLabel("Notes").fill("Paid in cash.");
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("saving updates the invoice in place", async ({ page }) => {
    const invoice = await loadedInvoice();
    await gotoEditInvoice(page, invoice);
    await page.getByLabel("Notes").fill("Paid in cash.");

    await saveInvoice(page).click();

    await expect(saveStatus(page)).toHaveText("Saved");
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}/edit$`));
    expect(await savedInvoices()).toMatchObject([{ id: invoice.id, notes: "Paid in cash." }]);
  });
});

test.describe("exporting the invoice", verified("2026-09-14"), () => {
  async function exportPdf(page: Page) {
    const download = page.waitForEvent("download");
    await actionBar(page).getByRole("button", { name: "Save + export" }).click();
    const file = await download;
    const savedAt = await file.path();
    return { filename: file.suggestedFilename(), text: await pdfText(fs.readFileSync(savedAt)) };
  }

  test("the export is named after the invoice", async ({ page }) => {
    const invoice = await loadedInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);

    const { filename, text } = await exportPdf(page);
    expect(filename).toBe("INV-0900.pdf");
    expect(text).not.toBe("");
  });

  test("the PDF says who it is for and when it is due", async ({ page }) => {
    const invoice = await loadedInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);
    const { text } = await exportPdf(page);

    expect(text).toContain("Tax invoice");
    expect(text).toContain("INV-0900");
    expect(text).toContain("Priya Nair");
    expect(text).toContain("Acme Constructions");
    expect(text).toContain("priya@acme.example");
    expect(text).toContain("02 9111 2222");
    expect(text).toContain(formatIsoDate("2026-08-26"));
    expect(text).toContain(formatIsoDate("2026-09-25"));
    expect(text).toContain("Alexandria");
  });

  test("the PDF lists every line as it was billed", async ({ page }) => {
    const invoice = await loadedInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);
    const { text } = await exportPdf(page);

    expect(text).toContain("PIPE-100");
    expect(text).toContain("Copper pipe 100mm");
    expect(text).toContain("$42.50");
    expect(text).toContain("$127.50");

    expect(text).toContain("LAB-HR");
    expect(text).toContain("Labour");
    expect(text).toContain("$120.00");
    expect(text).toContain("$240.00");
  });

  test("the PDF adds up the same way the form does", async ({ page }) => {
    const invoice = await loadedInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);
    const { text } = await exportPdf(page);

    expect(text).toContain("Subtotal $367.50");
    expect(text).toContain("Discount -$25.00");
    expect(text).toContain("Delivery $15.00");
    expect(text).toContain("Includes GST (10%) $32.50");
    expect(text).toContain("Total $357.50");
  });
});
