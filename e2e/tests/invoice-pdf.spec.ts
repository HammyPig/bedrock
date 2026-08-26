import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { formatIsoDate } from "~/lib/dates";
import { resetBusinessData } from "../support/db";
import { billTo, draft, line } from "../support/drafts";
import { CUSTOMERS, seedInvoice } from "../support/fixtures";
import { actionBar } from "../support/invoice-page";
import { pdfText } from "../support/pdf";

/**
 * X1-X6. The PDF is what the customer actually receives, so it is checked by
 * reading the text back out of the exported file rather than by trusting that
 * the renderer was handed the right props.
 */

test.beforeEach(async () => {
  await resetBusinessData();
});

/**
 * A fully loaded invoice: two lines, one discounted and one on backorder, an
 * invoice-level discount, delivery, GST, notes and a part payment.
 *
 * Subtotal 114.75 + 240.00 = 354.75; less 25.00, plus 15.00 delivery, is
 * 344.75 taxed at 10% for 34.48; total 379.23, less 50.00 paid, leaves 329.23.
 */
function loadedInvoice() {
  return seedInvoice(
    draft({
      invoiceNumber: "INV-0900",
      billTo: billTo({
        name: "Priya Nair",
        company: "Acme Constructions",
        email: "priya@acme.example",
        phone: "02 9111 2222",
        billingAddress: CUSTOMERS.acme.billingAddress,
        deliveryAddress: CUSTOMERS.acme.deliveryAddress,
      }),
      delivery: true,
      deliverySameAsBilling: false,
      lineItems: [
        line({
          sku: "PIPE-100",
          name: "Copper pipe 100mm",
          quantity: 3,
          unitPriceCents: 4250,
          discountPercent: 10,
        }),
        line({
          sku: "LAB-HR",
          name: "Labour",
          quantity: 2,
          unitPriceCents: 12_000,
          backordered: true,
        }),
      ],
      discount: { mode: "fixed", value: 2500 },
      freightCents: 1500,
      taxRatePercent: 10,
      notes: "Backordered items to follow.",
    }),
    [{ amountCents: 5000, paidDate: "2026-08-20" }],
  );
}

/** Exports the open invoice and reads the downloaded file back as text. */
async function exportPdf(page: Page) {
  const download = page.waitForEvent("download");
  await actionBar(page).getByRole("button", { name: "Save + export" }).click();
  const file = await download;
  const savedAt = await file.path();
  return { filename: file.suggestedFilename(), text: await pdfText(fs.readFileSync(savedAt)) };
}

test("X1 the export is named after the invoice", async ({ page }) => {
  const invoice = await loadedInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);

  const { filename, text } = await exportPdf(page);
  expect(filename).toBe("INV-0900.pdf");
  expect(text).not.toBe("");
});

test("X2 the PDF says who it is for and when it is due", async ({ page }) => {
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

  // Delivery was asked for and differs from billing, so it is spelled out.
  expect(text).toContain("Alexandria");
});

test("X3 the PDF lists every line as it was billed", async ({ page }) => {
  const invoice = await loadedInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);
  const { text } = await exportPdf(page);

  expect(text).toContain("PIPE-100");
  expect(text).toContain("Copper pipe 100mm");
  expect(text).toContain("$42.50");
  expect(text).toContain("$114.75");

  expect(text).toContain("LAB-HR");
  expect(text).toContain("Labour");
  expect(text).toContain("$120.00");
  expect(text).toContain("$240.00");

  expect(text).toContain("BACKORDERED");
  expect(text).toContain("Backordered items will ship separately.");
});

test("X4 the PDF adds up the same way the form does", async ({ page }) => {
  const invoice = await loadedInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);
  const { text } = await exportPdf(page);

  expect(text).toContain("Subtotal $354.75");
  expect(text).toContain("Discount -$25.00");
  expect(text).toContain("$15.00"); // the delivery cost; X6 covers what it is called
  expect(text).toContain("GST (10%) $34.48");
  expect(text).toContain("Total $379.23");
});

test("X5 the PDF shows what has been paid and what is left", async ({ page }) => {
  const invoice = await loadedInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);
  const { text } = await exportPdf(page);

  expect(text).toContain("Paid -$50.00");
  expect(text).toContain("Balance due $329.23");
});

test("X6 the PDF calls the delivery cost Delivery", async ({ page }) => {
  test.fail();
  const invoice = await loadedInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);
  const { text } = await exportPdf(page);

  // The same relabelling as T4b: an invoice bills a customer, and "Freight" is
  // the wholesaler's word. Both the form and the PDF have to change together.
  expect(text).toContain("Delivery $15.00");
});
