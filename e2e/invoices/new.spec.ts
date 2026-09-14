import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { computeTotals } from "~/app/invoices/_lib/money";
import { addDaysIso, formatIsoDate, todayIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { customerDetails, draft, line, payment } from "../support/drafts";
import { CUSTOMERS, ITEMS, seedCatalog, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  actionBar,
  addressInput,
  balanceDue,
  customerDetailsField,
  customerDetailsFlash,
  customerDetailsSection,
  deliveryCheckbox,
  documentType,
  dueDateText,
  editedMenu,
  fillAndCommit,
  fillMinimalInvoice,
  gotoNewInvoice,
  lineNames,
  lineSubtotal,
  openCustomerPicker,
  pickCustomer,
  replaceText,
  saveInvoice,
  saveNewInvoice,
  saveStatus,
  setTerms,
  startNewCustomer,
  totalsAmount,
  totalsPanel,
  updateCustomerPrompt,
} from "../support/invoice-page";
import { pdfText } from "../support/pdf";
import { trpcStreamResponse } from "../support/trpc";
import { verified } from "../support/verified";

test.beforeEach(async () => {
  await resetBusinessData();
});

function savedCustomers() {
  return testDb.query.customers.findMany({
    where: eq(schema.customers.businessId, TEST_BUSINESS_ID),
  });
}

function savedInvoices() {
  return testDb.query.invoices.findMany({
    where: eq(schema.invoices.businessId, TEST_BUSINESS_ID),
  });
}

function payableInvoice() {
  return seedInvoice(draft({ invoiceNumber: "INV-0900", lineItems: [line()] }));
}

/** A $200 line with 25% off and $20 delivery: $170.00 in total, $15.45 of it GST. */
async function fillTotalsExample(page: Page) {
  await page.getByLabel("Line 1 name").fill("Widget");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "200");
  await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
  await fillAndCommit(page.getByLabel("Discount percent"), "25");
  await fillAndCommit(page.getByLabel("Delivery", { exact: true }), "20");
}

/** Commits each value to an amount field and checks it was taken: shown as what it came to, unflagged. */
async function expectAccepted(field: Locator, cases: { typed: string; shows: string }[]) {
  for (const { typed, shows } of cases) {
    await test.step(`accepts "${typed}"`, async () => {
      await fillAndCommit(field, typed);
      await expect(field).toHaveValue(shows);
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
    });
  }
}

/**
 * Commits each value to an amount field and checks it was refused: kept as
 * typed, flagged, and explained. Errors are listed apart from their fields, so
 * most start with the field's name; `name` is that prefix.
 */
async function expectRefused(
  page: Page,
  field: Locator,
  cases: { typed: string; error: string }[],
  name?: string,
) {
  for (const { typed, error } of cases) {
    await test.step(`refuses "${typed}"`, async () => {
      await fillAndCommit(field, typed);
      await expect(field).toHaveValue(typed);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByText(name === undefined ? error : `${name}: ${error}`, { exact: true }),
      ).toBeVisible();
    });
  }
}

/** Every money field holds to the same rule: whole cents, never negative. */
const MONEY = {
  accepts: [
    { typed: "12.3", shows: "$12.30" },
    { typed: "12.340", shows: "$12.34" },
    { typed: ".5", shows: "$0.50" },
    { typed: "$1,200.50", shows: "$1,200.50" },
    { typed: "0.01", shows: "$0.01" },
    { typed: "", shows: "$0.00" },
  ],
  refuses: [
    { typed: "-0.01", error: "Can't be less than 0." },
    { typed: "12.345", error: "Use at most 2 decimal places." },
    { typed: "0.001", error: "Use at most 2 decimal places." },
    { typed: "abc", error: "Enter a number." },
    { typed: "1e3", error: "Enter a number." },
    { typed: "12.3.4", error: "Enter a number." },
  ],
};

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

  test.describe("a saved customer is found by any of their details", () => {
    test.beforeEach(async () => {
      await seedCustomer(CUSTOMERS.acme);
      await seedCustomer(CUSTOMERS.beacon);
    });

    for (const { by, query } of [
      { by: "name", query: "Priya" },
      { by: "company", query: "Acme" },
      { by: "phone", query: "9111" },
      { by: "email", query: "priya@acme" },
    ]) {
      test(`by ${by}`, async ({ page }) => {
        await gotoNewInvoice(page);
        await openCustomerPicker(page);
        await page.getByPlaceholder("Search customers...").fill(query);

        await expect(page.getByRole("option", { name: /Priya Nair/ })).toBeVisible();
        await expect(page.getByRole("option", { name: /Sam Okafor/ })).toBeHidden();
      });
    }
  });

  /**
   * A customer needs only one of company, name, email or phone, so anywhere one
   * is shown has to cope with the other three being blank. Named prioritised in
   * that order
   */
  test("a customer is named by the first identity they have", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await seedCustomer({ ...CUSTOMERS.beacon, company: "" });
    await seedCustomer({ ...CUSTOMERS.cashJob, company: "   ", name: "Jo Mitchell" });
    await seedCustomer({ ...CUSTOMERS.cashJob, email: "walkup@example.com" });
    await seedCustomer(CUSTOMERS.cashJob);
    await seedCustomer({ ...CUSTOMERS.cashJob, phone: "" });
    await gotoNewInvoice(page);
    await openCustomerPicker(page);

    await expect(page.getByRole("option", { name: /Acme Constructions/ })).toBeVisible();
    await expect(page.getByRole("option", { name: "Priya Nair", exact: true })).toBeHidden();
    await expect(page.getByRole("option", { name: "Sam Okafor", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Jo Mitchell", exact: true })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "walkup@example.com", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: "0433 777 888", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Unnamed customer", exact: true })).toBeVisible();

    await page.getByRole("option", { name: "0433 777 888", exact: true }).click();
    await expect(customerDetailsField(page, "Phone")).toHaveValue("0433 777 888");
    await expect(customerDetailsSection(page).getByRole("combobox")).toHaveText(/0433 777 888/);
  });

  test("a search matching nobody still offers to create one", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await gotoNewInvoice(page);
    await openCustomerPicker(page);
    await page.getByPlaceholder("Search customers...").fill("Nobody here");

    await expect(page.getByText("No customers found.")).toBeVisible();
    await expect(page.getByRole("option", { name: /^New customer/ })).toBeVisible();
  });

  test("the new customer option stays reachable no matter how many customers there are", async ({
    page,
  }) => {
    for (let i = 0; i < 15; i++) {
      await seedCustomer({ ...CUSTOMERS.acme, name: `Customer ${i}`, email: "", phone: "" });
    }
    await gotoNewInvoice(page);
    await openCustomerPicker(page);

    await expect(page.getByRole("option", { name: /^New customer/ })).toBeInViewport();
  });

  test.describe("after selecting a new customer", () => {
    for (const { what, query, field } of [
      { what: "letters are a name", query: "Kelly Brooks", field: "Name" },
      { what: "digits are a phone number", query: "0412 345 678", field: "Phone" },
      { what: "an @ is an email address", query: "kelly@brooks.example", field: "Email" },
      { what: "letters and digits together are a name", query: "Dave 0412", field: "Name" },
    ]) {
      test(`starts from what was typed: ${what}`, async ({ page }) => {
        await gotoNewInvoice(page);
        await openCustomerPicker(page);
        await page.getByPlaceholder("Search customers...").fill(query);
        await expect(page.getByRole("option", { name: `New customer “${query}”` })).toBeVisible();
        await page.getByRole("option", { name: /^New customer/ }).click();

        await expect(customerDetailsField(page, field)).toHaveValue(query);
        await expect(customerDetailsField(page, field)).toBeFocused();
        for (const other of ["Name", "Company", "Phone", "Email"].filter((f) => f !== field)) {
          await expect(customerDetailsField(page, other)).toHaveValue("");
        }
        await expect(customerDetailsSection(page).getByRole("combobox")).toHaveText("New customer");
      });
    }

    test("starts with empty fields when selected from an empty search", async ({ page }) => {
      await gotoNewInvoice(page);
      await openCustomerPicker(page);
      await page.getByRole("option", { name: "New customer", exact: true }).click();

      await expect(customerDetailsField(page, "Name")).toBeVisible();
      await expect(customerDetailsField(page, "Name")).toHaveValue("");
      await expect(customerDetailsField(page, "Name")).toBeFocused();
    });

    /**
     * There is no reason to write a customer down until the invoice is finalised,
     * so nothing is created before the save and an invoice abandoned half-filled
     * leaves nobody behind.
     */
    test("is only saved when the invoice is saved", async ({ page }) => {
      await gotoNewInvoice(page);
      await startNewCustomer(page, "Kelly Brooks");
      await customerDetailsField(page, "Company").fill("Brooks Joinery");
      await page.getByLabel("Line 1 name").fill("Callout fee");
      await fillAndCommit(page.getByLabel("Line 1 unit price"), "150.00");

      expect(await savedCustomers()).toEqual([]);

      await saveNewInvoice(page);
      expect(await savedCustomers()).toMatchObject([
        { name: "Kelly Brooks", company: "Brooks Joinery" },
      ]);
    });
  });

  /**
   * Sometimes a change belongs to this invoice alone — a different phone number,
   * an extra email — and sometimes it belongs on the customer's record. The form
   * cannot tell which, so it shows that an edit was made and leaves the choice.
   * The prompt on save is the unskippable version of the same question, there so
   * a change cannot simply be forgotten.
   */
  test.describe("after selecting an existing customer", () => {
    test("picking one fills the fields, ready to edit", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);

      await pickCustomer(page, /Priya Nair/, "Acme");

      await expect(customerDetailsField(page, "Name")).toHaveValue("Priya Nair");
      await expect(customerDetailsField(page, "Company")).toHaveValue("Acme Constructions");
      await expect(customerDetailsField(page, "Phone")).toHaveValue("02 9111 2222");
      await expect(customerDetailsField(page, "Email")).toHaveValue("priya@acme.example");
      await expect(addressInput(page, "Billing")).toHaveValue(
        "14 Wharf Road, Level 3, Pyrmont NSW 2009",
      );
      await expect(customerDetailsField(page, "Name")).toBeEditable();
      await expect(editedMenu(page)).toBeHidden();
    });

    test("editing them changes the invoice, not their record", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);

      await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");
      await customerDetailsField(page, "Email").click();

      expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
    });

    test("a status shows when they have been edited", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await expect(editedMenu(page)).toBeHidden();

      await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");
      await expect(editedMenu(page)).toBeVisible();

      await replaceText(customerDetailsField(page, "Phone"), "02 9111 2222");
      await expect(editedMenu(page)).toBeHidden();
    });

    test("edits can be saved to the customer", async ({ page }) => {
      const customer = await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");

      await editedMenu(page).click();
      await expect(page.getByRole("menuitem", { name: "Update saved customer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Reset to saved" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /Save as new/ })).toBeHidden();
      await page.getByRole("menuitem", { name: "Update saved customer" }).click();

      await expect(customerDetailsFlash(page)).toHaveText("Updated");
      await expect(editedMenu(page)).toBeHidden();
      expect(await savedCustomers()).toMatchObject([{ id: customer.id, phone: "02 9333 4444" }]);
    });

    test("edits can be reset", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");

      await editedMenu(page).click();
      await page.getByRole("menuitem", { name: "Reset to saved" }).click();

      await expect(customerDetailsField(page, "Phone")).toHaveValue("02 9111 2222");
      await expect(editedMenu(page)).toBeHidden();
      expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
    });

    test("unsaved edits are prompted to be saved when the invoice is saved", async ({ page }) => {
      const customer = await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await fillMinimalInvoice(page, /Priya Nair/);
      await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");

      await saveInvoice(page).click();

      await expect(updateCustomerPrompt(page)).toBeVisible();
      await expect(updateCustomerPrompt(page)).toContainText("Acme Constructions");
      await updateCustomerPrompt(page).getByRole("button", { name: "Update customer" }).click();

      await page.waitForURL(/\/invoices\/[^/]+\/edit$/);
      expect(await savedCustomers()).toMatchObject([{ id: customer.id, phone: "02 9333 4444" }]);
    });
  });

  test("needs at least one of name, company, phone or email", async ({ page }) => {
    await gotoNewInvoice(page);
    await startNewCustomer(page);

    await page.getByLabel("Line 1 name").fill("Callout fee");
    await saveInvoice(page).click();

    await expect(page.getByText("Select a customer to bill.")).toBeVisible();
    expect(await savedCustomers()).toEqual([]);
  });

  test.describe("switching customer", () => {
    test("from a saved or new customer to another saved customer resets every field and fills in their details", async ({
      page,
    }) => {
      test.fixme();
      await seedCustomer(CUSTOMERS.acme);
      await seedCustomer(CUSTOMERS.cashJob);
      await gotoNewInvoice(page);

      await pickCustomer(page, /Priya Nair/);
      await deliveryCheckbox(page).check();

      await pickCustomer(page, /0433 777 888/);
      await expect(customerDetailsField(page, "Phone")).toHaveValue("0433 777 888");
      await expect(customerDetailsField(page, "Name")).toHaveValue("");
      await expect(customerDetailsField(page, "Company")).toHaveValue("");
      await expect(customerDetailsField(page, "Email")).toHaveValue("");
      await expect(page.getByLabel("Billing address search")).toBeVisible();
      await expect(deliveryCheckbox(page)).not.toBeChecked();

      await startNewCustomer(page, "Kelly Brooks");
      await deliveryCheckbox(page).check();

      await pickCustomer(page, /Priya Nair/);
      await expect(customerDetailsField(page, "Name")).toHaveValue("Priya Nair");
      await expect(customerDetailsField(page, "Company")).toHaveValue("Acme Constructions");
      await expect(customerDetailsField(page, "Email")).toHaveValue("priya@acme.example");
      await expect(addressInput(page, "Billing")).toHaveValue(
        "14 Wharf Road, Level 3, Pyrmont NSW 2009",
      );
      await expect(deliveryCheckbox(page)).not.toBeChecked();
    });

    test("from a saved customer to a new customer resets every field", async ({ page }) => {
      test.fixme();
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);

      await pickCustomer(page, /Priya Nair/);
      await deliveryCheckbox(page).check();

      await startNewCustomer(page);
      for (const field of ["Name", "Company", "Phone", "Email"]) {
        await expect(customerDetailsField(page, field)).toHaveValue("");
      }
      await expect(page.getByLabel("Billing address search")).toBeVisible();
      await expect(deliveryCheckbox(page)).not.toBeChecked();
    });

    test("from a new customer to a new customer, and from a saved customer to the same saved customer, does nothing", async ({
      page,
    }) => {
      test.fixme();
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);

      await startNewCustomer(page, "Kelly Brooks");
      await customerDetailsField(page, "Company").fill("Brooks Joinery");
      await deliveryCheckbox(page).check();

      await startNewCustomer(page);
      await expect(customerDetailsField(page, "Name")).toHaveValue("Kelly Brooks");
      await expect(customerDetailsField(page, "Company")).toHaveValue("Brooks Joinery");
      await expect(deliveryCheckbox(page)).toBeChecked();

      await pickCustomer(page, /Priya Nair/);
      await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");
      await deliveryCheckbox(page).check();

      await pickCustomer(page, /Priya Nair/);
      await expect(customerDetailsField(page, "Phone")).toHaveValue("02 9333 4444");
      await expect(editedMenu(page)).toBeVisible();
      await expect(deliveryCheckbox(page)).toBeChecked();
    });
  });

  test.describe("the address field", () => {
    test("is entered by lookup while it is empty", async ({ page }) => {
      await gotoNewInvoice(page);
      await startNewCustomer(page, "Kelly Brooks");

      await page.getByLabel("Billing address search").fill("Cartwright");
      await page.getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" }).click();

      await expect(addressInput(page, "Billing")).toHaveValue(
        "6097 Cartwright Track, North Eve ACT 0897",
      );
    });

    test("can be typed out instead of looked up", async ({ page }) => {
      await gotoNewInvoice(page);
      await startNewCustomer(page, "Kelly Brooks");

      await page.getByRole("button", { name: "Enter address manually" }).first().click();
      await page.getByLabel("Billing address line 1").fill("9 Bay Street");
      await page.getByLabel("Billing suburb").fill("Ultimo");
      await page.getByLabel("Billing state").fill("NSW");
      await page.getByLabel("Billing postcode").fill("2007");

      await customerDetailsField(page, "Company").click();
      await expect(addressInput(page, "Billing")).toHaveValue("9 Bay Street, Ultimo NSW 2007");
    });

    test("shows as one line and opens to its parts", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);

      const oneLine = addressInput(page, "Billing");
      await expect(oneLine).toHaveValue("14 Wharf Road, Level 3, Pyrmont NSW 2009");

      await oneLine.click();
      await expect(page.getByLabel("Billing address line 1")).toHaveValue("14 Wharf Road");
      await expect(page.getByLabel("Billing address line 2")).toHaveValue("Level 3");
      await expect(page.getByLabel("Billing suburb")).toHaveValue("Pyrmont");
      await expect(page.getByLabel("Billing state")).toHaveValue("NSW");
      await expect(page.getByLabel("Billing postcode")).toHaveValue("2009");

      await customerDetailsField(page, "Company").click();
      await expect(oneLine).toBeVisible();
      await expect(page.getByLabel("Billing address line 1")).toBeHidden();
    });

    test("still looks up addresses from its first line while in manual mode", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);

      await addressInput(page, "Billing").click();
      await page.getByLabel("Billing address line 1").fill("Cartwright");
      await page.getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" }).click();

      await expect(page.getByLabel("Billing suburb")).toHaveValue("North Eve");
      await expect(page.getByLabel("Billing postcode")).toHaveValue("0897");
    });
  });

  test.describe("the delivery address", () => {
    test("defaults to off", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);

      await expect(deliveryCheckbox(page)).not.toBeChecked();
      await expect(addressInput(page, "Delivery")).toBeHidden();
    });

    test("defaults to the billing address", async ({ page }) => {
      await seedCustomer(CUSTOMERS.beacon);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Sam Okafor/);
      await deliveryCheckbox(page).check();

      await expect(customerDetailsSection(page).getByText("Same as billing address")).toBeVisible();
    });

    test("defaults to a separate address when the customer has one", async ({ page }) => {
      test.fixme();
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await deliveryCheckbox(page).check();

      await expect(customerDetailsSection(page).getByText("Same as billing address")).toBeHidden();
      await expect(addressInput(page, "Delivery")).toHaveValue(
        "88 Depot Lane, Alexandria NSW 2015",
      );
    });

    test("can be switched between billing and its own address", async ({ page }) => {
      await seedCustomer(CUSTOMERS.beacon);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Sam Okafor/);
      await deliveryCheckbox(page).check();

      await customerDetailsSection(page)
        .getByRole("button", { name: "Use different address" })
        .click();
      await expect(customerDetailsSection(page).getByText("Same as billing address")).toBeHidden();
      await expect(page.getByLabel("Delivery address search")).toBeVisible();

      await customerDetailsSection(page)
        .getByRole("button", { name: "Use billing address" })
        .click();
      await expect(customerDetailsSection(page).getByText("Same as billing address")).toBeVisible();
    });
  });
});

test.describe("invoice metadata section", verified("2026-09-13"), () => {
  test("a new invoice is issued today", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(page.getByLabel("Issue date")).toHaveValue(todayIsoDate());
  });

  test.describe("the terms decide the due date", () => {
    for (const { terms, days } of [
      { terms: "Due on receipt", days: 0 },
      { terms: "Net 7", days: 7 },
      { terms: "Net 14", days: 14 },
      { terms: "Net 30", days: 30 },
    ]) {
      test(`${terms} is due ${days} days after issue`, async ({ page }) => {
        await gotoNewInvoice(page);
        await setTerms(page, terms);
        await expect(dueDateText(page)).toHaveText(formatIsoDate(addDaysIso(todayIsoDate(), days)));
      });
    }
  });

  test("custom terms hand the due date over to be set", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(dueDateText(page)).toBeVisible();

    await setTerms(page, "Custom");
    await page.getByLabel("Due date").fill("2026-12-01");
    await expect(page.getByLabel("Due date")).toHaveValue("2026-12-01");
  });

  test("changing the issue date moves the due date with it", async ({ page }) => {
    await gotoNewInvoice(page);
    await setTerms(page, "Net 7");
    await page.getByLabel("Issue date").fill("2026-01-31");

    await expect(dueDateText(page)).toHaveText(formatIsoDate("2026-02-07"));
  });

  test("can be switched to a quote and back", async ({ page }) => {
    await gotoNewInvoice(page);

    await documentType(page).getByRole("button", { name: "Quote" }).click();
    await expect(page.getByRole("heading", { name: "New quote" })).toBeVisible();

    await documentType(page).getByRole("button", { name: "Invoice" }).click();
    await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  });
});

test.describe("items section", verified("2026-09-13"), () => {
  test("an initial line is ready to type into", async ({ page }) => {
    await seedCatalog();
    await gotoNewInvoice(page);

    await page.getByLabel("Line 1 name").fill("Emergency callout, after hours");
    await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "185");

    await expect(page.getByLabel("Line 1 name")).toHaveValue("Emergency callout, after hours");
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$185.00");
    await expect(lineSubtotal(page, 1)).toHaveText("$370.00");
  });

  test("a SKU finds its catalog item", async ({ page }) => {
    await seedCatalog();
    await gotoNewInvoice(page);

    await page.getByLabel("Line 1 SKU").fill("PIPE-100");
    await expect(page.getByRole("button", { name: /Copper pipe 100mm/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Copper pipe 1000mm/ })).toBeVisible();

    await page.getByRole("button", { name: /Copper pipe 100mm/ }).click();
    await expect(page.getByLabel("Line 1 SKU")).toHaveValue("PIPE-100");
    await expect(page.getByLabel("Line 1 name")).toHaveValue("Copper pipe 100mm");
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$42.50");
  });

  test("the same lookup works from the name", async ({ page }) => {
    await seedCatalog();
    await gotoNewInvoice(page);

    await page.getByLabel("Line 1 name").fill("Labour");
    await page.getByRole("button", { name: /Labour \(per hour\)/ }).click();

    await expect(page.getByLabel("Line 1 SKU")).toHaveValue("LAB-HR");
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$120.00");
  });

  test("changing a line never edits the catalog item", async ({ page }) => {
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

  test("the line subtotal follows quantity and price", async ({ page }) => {
    await gotoNewInvoice(page);

    await page.getByLabel("Line 1 name").fill("Copper pipe");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "10.50");
    await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
    await expect(lineSubtotal(page, 1)).toHaveText("$31.50");

    await fillAndCommit(page.getByLabel("Line 1 quantity"), "4");
    await expect(lineSubtotal(page, 1)).toHaveText("$42.00");
  });

  test("the line subtotal is calculated, never typed", async ({ page }) => {
    await gotoNewInvoice(page);

    await page.getByLabel("Line 1 name").fill("Copper pipe");
    await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "60");

    await expect(lineSubtotal(page, 1)).toHaveText("$120.00");
    await expect(page.getByLabel("Line 1 subtotal")).toHaveCount(0);
  });

  test("a line quantity takes any amount above 0, to three decimal places", async ({ page }) => {
    await gotoNewInvoice(page);
    await expectAccepted(page.getByLabel("Line 1 quantity", { exact: true }), [
      { typed: "2.50", shows: "2.5" },
      { typed: "0.001", shows: "0.001" },
      { typed: "1.234", shows: "1.234" },
      { typed: "1,000", shows: "1000" },
    ]);
  });

  test("a line quantity refuses anything else", async ({ page }) => {
    await gotoNewInvoice(page);
    await expectRefused(
      page,
      page.getByLabel("Line 1 quantity", { exact: true }),
      [
        { typed: "0", error: "Must be more than 0." },
        { typed: "", error: "Must be more than 0." },
        { typed: "-1", error: "Must be more than 0." },
        { typed: "1.2345", error: "Use at most 3 decimal places." },
        { typed: "0.0001", error: "Use at most 3 decimal places." },
        { typed: "abc", error: "Enter a number." },
        { typed: "1e3", error: "Enter a number." },
      ],
      "Line 1 quantity",
    );
  });

  test("a unit price takes any amount of $0 or more, to the cent", async ({ page }) => {
    await gotoNewInvoice(page);
    await expectAccepted(page.getByLabel("Line 1 unit price", { exact: true }), MONEY.accepts);
  });

  test("a unit price refuses anything else", async ({ page }) => {
    await gotoNewInvoice(page);
    await expectRefused(
      page,
      page.getByLabel("Line 1 unit price", { exact: true }),
      MONEY.refuses,
      "Line 1 unit price",
    );
  });

  test("adding a new line starts with empty fields ready to type into", async ({ page }) => {
    await gotoNewInvoice(page);

    await page.getByRole("button", { name: "Add item" }).click();

    await expect(page.getByLabel("Line 2 SKU")).toBeVisible();
    await expect(page.getByLabel("Line 2 SKU")).toBeFocused();
  });

  test("a line can be removed", async ({ page }) => {
    await gotoNewInvoice(page);

    await page.getByLabel("Line 1 name").fill("First");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByLabel("Line 2 name").fill("Second");
    await page.getByRole("button", { name: "Remove line 1" }).click();

    expect(await lineNames(page)).toEqual(["Second"]);
  });

  test("the last line cannot be removed", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(page.getByRole("button", { name: "Remove line 1" })).toBeDisabled();

    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("button", { name: "Remove line 1" })).toBeEnabled();
  });

  test("a line can be moved up and down", async ({ page }) => {
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
});

test.describe("balance section", verified("2026-09-14"), () => {
  test("notes can be written on the invoice", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Notes").fill("Please pay by bank transfer.");
    await expect(page.getByLabel("Notes")).toHaveValue("Please pay by bank transfer.");
  });

  test("the subtotal is the sum of the line subtotals", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Line 1 name").fill("Widget");
    await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "100");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByLabel("Line 2 name").fill("Labour");
    await fillAndCommit(page.getByLabel("Line 2 unit price"), "120");

    await expect(totalsAmount(page, "Subtotal")).toHaveText("$320.00");
  });

  test("a discount can be added", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Line 1 name").fill("Widget");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "200");
    await expect(page.getByLabel("Discount percent")).toBeHidden();

    await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
    await fillAndCommit(page.getByLabel("Discount percent"), "10");

    await expect(totalsAmount(page, "Discount")).toHaveText("-$20.00");
  });

  test("a discount is a percentage or an amount", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Line 1 name").fill("Widget");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "200");

    await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
    await fillAndCommit(page.getByLabel("Discount percent"), "25");
    await expect(totalsAmount(page, "Discount")).toHaveText("-$50.00");

    await totalsPanel(page).getByRole("button", { name: "$", exact: true }).click();
    await expect(page.getByLabel("Discount amount")).toHaveValue("0.00");
    await fillAndCommit(page.getByLabel("Discount amount"), "30");
    await expect(totalsAmount(page, "Discount")).toHaveText("-$30.00");
  });

  test("a discount percentage takes 0 to 100, to two decimal places", async ({ page }) => {
    await gotoNewInvoice(page);
    await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
    await expectAccepted(page.getByLabel("Discount percent", { exact: true }), [
      { typed: "12.50", shows: "12.5" },
      { typed: "0.01", shows: "0.01" },
      { typed: "100", shows: "100" },
      { typed: "", shows: "0" },
      { typed: "33.33", shows: "33.33" },
      { typed: "0", shows: "0" },
    ]);
  });

  test("a discount percentage refuses anything else", async ({ page }) => {
    await gotoNewInvoice(page);
    await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
    await expectRefused(
      page,
      page.getByLabel("Discount percent", { exact: true }),
      [
        { typed: "100.01", error: "Can't be more than 100." },
        { typed: "150", error: "Can't be more than 100." },
        { typed: "-0.01", error: "Can't be less than 0." },
        { typed: "33.333", error: "Use at most 2 decimal places." },
        { typed: "abc", error: "Enter a number." },
      ],
      "Discount percent",
    );
  });

  test("a discount can be taken off again", async ({ page }) => {
    await gotoNewInvoice(page);
    await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
    await expect(page.getByLabel("Discount percent")).toBeVisible();

    await totalsPanel(page).getByRole("button", { name: "Remove discount" }).click();
    await expect(page.getByLabel("Discount percent")).toBeHidden();
    await expect(totalsPanel(page).getByRole("button", { name: "Add discount" })).toBeVisible();
  });

  test("delivery takes any amount of $0 or more, to the cent", async ({ page }) => {
    await gotoNewInvoice(page);
    await expectAccepted(page.getByLabel("Delivery", { exact: true }), MONEY.accepts);
  });

  test("delivery refuses anything else", async ({ page }) => {
    await gotoNewInvoice(page);
    await expectRefused(page, page.getByLabel("Delivery", { exact: true }), MONEY.refuses);
  });

  test("the total is the subtotal less the discount, plus delivery", async ({ page }) => {
    await gotoNewInvoice(page);
    await fillTotalsExample(page);

    await expect(totalsAmount(page, "Subtotal")).toHaveText("$200.00");
    await expect(totalsAmount(page, "Discount")).toHaveText("-$50.00");
    await expect(totalsAmount(page, "Total")).toHaveText("$170.00");
  });

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

  test("the GST shown is the total divided by 11", async ({ page }) => {
    await gotoNewInvoice(page);
    await fillTotalsExample(page);

    await expect(totalsAmount(page, "Total")).toHaveText("$170.00");
    await expect(totalsAmount(page, "Includes GST (10%)")).toHaveText("$15.45");
  });
});

test.describe("amount field errors", () => {
  test("the error follows the text as it is corrected", async ({ page }) => {
    await gotoNewInvoice(page);
    const quantity = page.getByLabel("Line 1 quantity");
    await fillAndCommit(quantity, "1.2345");
    await expect(page.getByText("Line 1 quantity: Use at most 3 decimal places.")).toBeVisible();

    await quantity.click();
    await quantity.fill("1.23a");
    await expect(page.getByText("Line 1 quantity: Enter a number.")).toBeVisible();

    await quantity.fill("1.25");
    await expect(page.getByText(/^Line 1 quantity:/)).toBeHidden();
    await expect(quantity).not.toHaveAttribute("aria-invalid", "true");

    await quantity.blur();
    await expect(quantity).toHaveValue("1.25");
  });

  test("removing the field removes its error", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByRole("button", { name: "Add item" }).click();
    await fillAndCommit(page.getByLabel("Line 2 quantity"), "1.2345");
    await expect(saveStatus(page)).toHaveText("Fix the field above");

    await page.getByRole("button", { name: "Remove line 2" }).click();

    await expect(page.getByText(/^Line 2 quantity:/)).toBeHidden();
    await expect(saveStatus(page)).toHaveText("Draft");
  });
});

test.describe("the action bar", () => {
  test("a new invoice is a draft", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("saving is refused if an error is present", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);
    await fillAndCommit(page.getByLabel("Line 1 quantity"), "1.2345");
    await fillAndCommit(page.getByLabel("Delivery", { exact: true }), "-5");

    await saveInvoice(page).click();
    await expect(saveStatus(page)).toHaveText("Fix 2 fields above");
    expect(await savedInvoices()).toEqual([]);

    await fillAndCommit(page.getByLabel("Delivery", { exact: true }), "5");
    await expect(saveStatus(page)).toHaveText("Fix the field above");
    await fillAndCommit(page.getByLabel("Line 1 quantity"), "1.5");
    await expect(saveStatus(page)).toHaveText("Draft");

    await saveNewInvoice(page);
    await expect(page.getByLabel("Line 1 quantity")).toHaveValue("1.5");
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

test.describe("exporting the invoice", () => {
  function loadedInvoice() {
    return seedInvoice(
      draft({
        invoiceNumber: "INV-0900",
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
        payments: [payment()],
      }),
    );
  }

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
    expect(text).toContain("$15.00");
    expect(text).toContain("GST (10%) $35.75");
    expect(text).toContain("Total $393.25");
  });

  test("the PDF shows what has been paid and what is left", async ({ page }) => {
    const invoice = await loadedInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);
    const { text } = await exportPdf(page);

    expect(text).toContain("Paid -$50.00");
    expect(text).toContain("Balance due $343.25");
  });
});
