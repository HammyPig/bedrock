import { expect, test, type Page } from "@playwright/test";

import { computeTotals } from "~/app/invoices/_lib/money";
import { formatCents } from "~/lib/money";
import { todayIsoDate } from "~/lib/dates";
import { resetBusinessData } from "../support/db";
import { billTo, draft, line } from "../support/drafts";
import { CUSTOMERS, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  actionBar,
  balanceDue,
  fillAndCommit,
  fillMinimalInvoice,
  gotoNewInvoice,
  replaceText,
  saveInvoice,
  saveNewInvoice,
  saveStatus,
  totalsAmount,
  totalsPanel,
} from "../support/invoice-page";
import { trpcStreamResponse } from "../support/trpc";

/**
 * T1-T12, S1-S5, E1-E4. What the invoice adds up to, what has been paid against
 * it, whether it has been saved, and sending it on.
 */

test.beforeEach(async () => {
  await resetBusinessData();
});

/** A saved invoice worth $110.00: one $100.00 line plus 10% GST. */
function payableInvoice() {
  return seedInvoice(draft({ invoiceNumber: "INV-0900", lineItems: [line()] }));
}

test("T1 notes can be written on the invoice", async ({ page }) => {
  await gotoNewInvoice(page);
  await page.getByLabel("Notes").fill("Please pay by bank transfer.");
  await expect(page.getByLabel("Notes")).toHaveValue("Please pay by bank transfer.");
});

test("T2 a discount is a percentage or an amount", async ({ page }) => {
  await gotoNewInvoice(page);
  await page.getByLabel("Line 1 name").fill("Widget");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "200");

  await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
  await fillAndCommit(page.getByLabel("Discount percent"), "25");
  await expect(totalsAmount(page, "Discount")).toHaveText("-$50.00");

  // Switching mode starts the amount over rather than reading 25 as $0.25.
  await totalsPanel(page).getByRole("button", { name: "$", exact: true }).click();
  await expect(page.getByLabel("Discount amount")).toHaveValue("0.00");
  await fillAndCommit(page.getByLabel("Discount amount"), "30");
  await expect(totalsAmount(page, "Discount")).toHaveText("-$30.00");
});

test("T3 a discount can be taken off again", async ({ page }) => {
  await gotoNewInvoice(page);
  await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
  await expect(page.getByLabel("Discount percent")).toBeVisible();

  await totalsPanel(page).getByRole("button", { name: "Remove discount" }).click();
  await expect(page.getByLabel("Discount percent")).toBeHidden();
  await expect(totalsPanel(page).getByRole("button", { name: "Add discount" })).toBeVisible();
});

test("T4 a delivery cost is added before GST", async ({ page }) => {
  await gotoNewInvoice(page);
  await page.getByLabel("Line 1 name").fill("Widget");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "100");
  await fillAndCommit(page.getByLabel("Freight"), "20");

  // GST covers the goods and the delivery together: (100 + 20) x 10%.
  await expect(totalsAmount(page, "GST")).toHaveText("$12.00");
  await expect(totalsAmount(page, "Total")).toHaveText("$132.00");
});

test("T4b the invoice calls the delivery cost Delivery", async ({ page }) => {
  test.fail();
  await gotoNewInvoice(page);

  // "Freight" is the wholesaler's word and belongs on a purchase order; an
  // invoice bills a customer, beside the "Delivery address" toggle above it.
  await expect(totalsPanel(page).getByText("Delivery", { exact: true })).toBeVisible();
});

test("T5 the balance shown is the balance calculated", async ({ page }) => {
  await gotoNewInvoice(page);
  await page.getByLabel("Line 1 name").fill("Widget");
  await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "19.99");
  await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
  await fillAndCommit(page.getByLabel("Discount percent"), "15");
  await fillAndCommit(page.getByLabel("Freight"), "12.50");

  // The arithmetic itself is covered by the unit specs; this asserts only that
  // the panel is showing what the same function produces.
  const expected = computeTotals({
    lineItems: [line({ quantity: 3, unitPriceCents: 1999 })],
    discount: { mode: "percent", value: 15 },
    freightCents: 1250,
    taxRatePercent: 10,
  });
  await expect(balanceDue(page)).toHaveText(formatCents(expected.balanceCents));
});

test("T6 an unsaved invoice cannot take a payment", async ({ page }) => {
  await gotoNewInvoice(page);
  await expect(page.getByRole("button", { name: "Record full payment" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Record partial payment" })).toBeHidden();
});

test("T7 a quote cannot take a payment", async ({ page }) => {
  const quote = await seedInvoice(
    draft({ documentType: "quote", invoiceNumber: "QUO-0001", lineItems: [line()] }),
  );
  await page.goto(`/invoices/${quote.id}/edit`);

  await expect(balanceDue(page)).toHaveText("$110.00");
  await expect(page.getByRole("button", { name: "Record full payment" })).toBeHidden();
});

test("T8 the whole balance can be paid off at once", async ({ page }) => {
  const invoice = await payableInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);
  await expect(balanceDue(page)).toHaveText("$110.00");

  await page.getByRole("button", { name: "Record full payment" }).click();

  await expect(balanceDue(page)).toHaveText("$0.00");
  await expect(totalsPanel(page).getByText(/^Paid /)).toBeVisible();
});

test("T9 part of the balance can be paid", async ({ page }) => {
  const invoice = await payableInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);

  await page.getByRole("button", { name: "Record partial payment" }).click();
  await expect(page.getByLabel("Payment date")).toHaveValue(todayIsoDate());

  await fillAndCommit(page.getByLabel("Payment amount"), "40");
  await page.getByRole("button", { name: "Record", exact: true }).click();

  await expect(balanceDue(page)).toHaveText("$70.00");
});

test("T10 a payment can be taken back off", async ({ page }) => {
  const invoice = await payableInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);

  await page.getByRole("button", { name: "Record full payment" }).click();
  await expect(balanceDue(page)).toHaveText("$0.00");

  await page.getByRole("button", { name: "Delete payment" }).click();
  await expect(balanceDue(page)).toHaveText("$110.00");
});

test("T11 a settled invoice stops asking for payment", async ({ page }) => {
  const invoice = await payableInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);

  await page.getByRole("button", { name: "Record full payment" }).click();
  await expect(balanceDue(page)).toHaveText("$0.00");

  await expect(page.getByRole("button", { name: "Record full payment" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Record partial payment" })).toBeHidden();
});

test("T12 a payment records how it was paid", async ({ page }) => {
  test.fixme();
  const invoice = await payableInvoice();
  await page.goto(`/invoices/${invoice.id}/edit`);

  await page.getByRole("button", { name: "Record partial payment" }).click();
  // Card is what most small businesses take, so it is the default.
  await expect(page.getByLabel("Payment method")).toHaveValue("card");

  await page.getByLabel("Payment method").selectOption("bank_transfer");
  await fillAndCommit(page.getByLabel("Payment amount"), "40");
  await page.getByRole("button", { name: "Record", exact: true }).click();

  await expect(totalsPanel(page).getByText(/Bank transfer/)).toBeVisible();
});

test.describe("S1-S5 whether the invoice has been saved", () => {
  test("S1 a new invoice is a draft", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("S3 saving says so, and S2 the next edit takes it back to a draft", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);

    await saveNewInvoice(page);
    await expect(saveStatus(page)).toHaveText("Saved");

    await page.getByLabel("Notes").fill("Added after saving.");
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("S4 a saved invoice opens as saved", async ({ page }) => {
    const invoice = await payableInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);
    await expect(saveStatus(page)).toHaveText("Saved");
  });

  test("S5 a refused save reports why, in place of the status", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);
    await replaceText(page.getByLabel("Invoice no."), "INV-0900");

    await saveInvoice(page).click();
    await expect(saveStatus(page)).toHaveText("Invoice number INV-0900 already exists.");
    await expect(saveStatus(page)).not.toHaveText("Draft");
  });
});

test.describe("E1-E5 sending the invoice", () => {
  /** A saved invoice addressed to someone, so a send has somewhere to go. */
  function emailableInvoice(email = "priya@acme.example") {
    return seedInvoice(
      draft({ invoiceNumber: "INV-0900", billTo: billTo({ email }), lineItems: [line()] }),
    );
  }

  /**
   * The send happens server-side through Resend, so there is no request to
   * Resend for a browser test to intercept. What can be intercepted is the
   * mutation the UI issues, which stands in for the reply it cannot get with
   * credentials deliberately unset.
   */
  async function stubSend(page: Page, sentTo = "priya@acme.example") {
    await page.route("**/api/trpc/invoice.sendEmail*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: trpcStreamResponse({ sentTo }),
      }),
    );
  }

  test("E1 Save + email saves first, then sends, and confirms where", async ({ page }) => {
    const invoice = await emailableInvoice();
    await stubSend(page);

    const sent = page.waitForRequest((request) =>
      request.url().includes("/api/trpc/invoice.sendEmail"),
    );
    await page.goto(`/invoices/${invoice.id}/edit`);
    await actionBar(page).getByRole("button", { name: "Save + email" }).click();

    await sent;
    await expect(saveStatus(page)).toHaveText("Sent to priya@acme.example");
  });

  test("E2 a customer with no email address is asked for one", async ({ page }) => {
    const invoice = await emailableInvoice("");
    await page.goto(`/invoices/${invoice.id}/edit`);

    await actionBar(page).getByRole("button", { name: "Save + email" }).click();
    await expect(saveStatus(page)).toHaveText("Add an email address to the billing details first.");
  });

  test("E3 sending without email configured says so", async ({ page }) => {
    const invoice = await emailableInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);

    // The suite runs with RESEND_API_KEY and EMAIL_FROM blanked, so a test can
    // never post mail to a real address. Nothing is stubbed here: this is the
    // real server answering.
    await actionBar(page).getByRole("button", { name: "Save + email" }).click();
    await expect(saveStatus(page)).toHaveText(
      "Email sending isn't configured — set RESEND_API_KEY and EMAIL_FROM.",
    );
  });

  test("E4 the confirmation does not outlive the invoice it described", async ({ page }) => {
    const invoice = await emailableInvoice();
    await stubSend(page);
    await page.goto(`/invoices/${invoice.id}/edit`);

    await actionBar(page).getByRole("button", { name: "Save + email" }).click();
    await expect(saveStatus(page)).toHaveText("Sent to priya@acme.example");

    await page.getByLabel("Notes").fill("Changed after sending.");
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("E5 emailing a brand new invoice still reports what happened", async ({ page }) => {
    test.fail();
    await seedCustomer(CUSTOMERS.acme);
    await stubSend(page);

    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);
    await actionBar(page).getByRole("button", { name: "Save + email" }).click();

    // Creating an invoice redirects to its own edit page, which mounts a fresh
    // form and drops the send result with it — so neither a confirmation nor a
    // failure ever reaches the person who pressed the button.
    await page.waitForURL(/\/invoices\/[^/]+\/edit$/);
    await expect(saveStatus(page)).toHaveText("Sent to priya@acme.example");
  });
});
