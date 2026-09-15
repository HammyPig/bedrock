import { expect, test, type Locator, type Page, type TestDetails } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { addDaysIso, formatIsoDate } from "~/lib/dates";
import { TEST_BUSINESS_ID, testDb } from "../support/db";
import { CUSTOMERS, ITEMS, seedCatalog, seedCustomer } from "../support/fixtures";
import {
  addressInput,
  customerDetailsField,
  customerDetailsFlash,
  customerDetailsSection,
  deliveryCheckbox,
  dueDateText,
  editedMenu,
  fillAndCommit,
  fillMinimalInvoice,
  lineNames,
  lineSubtotal,
  openCustomerPicker,
  pickCustomer,
  replaceText,
  saveInvoice,
  saveStatus,
  setTerms,
  startNewCustomer,
  totalsAmount,
  totalsPanel,
  updateCustomerPrompt,
} from "../support/invoice-page";

/**
 * How the shared tests reach the form. A new invoice and an edit render the same
 * form, so what they have in common is written once here and run on both routes;
 * each route's spec adds what only it does.
 */
export interface InvoiceFormRoute {
  /** Heads the shared tests, which otherwise report the same file, line and title on both routes. */
  name: string;
  /** Lands on the form ready to use: blank for a new invoice, a plain saved one for an edit. */
  open(page: Page): Promise<void>;
  /** Waits for a save already under way to land. */
  saved(page: Page): Promise<void>;
  /** The route's own verified marker: a human checking one route doesn't vouch for the other. */
  verified(date: string): TestDetails;
}

function savedCustomers() {
  return testDb.query.customers.findMany({
    where: eq(schema.customers.businessId, TEST_BUSINESS_ID),
  });
}

function savedCustomer(id: string) {
  return testDb.query.customers.findFirst({ where: eq(schema.customers.id, id) });
}

/** Customers saved after `before` was read, since an edit opens with one saved already. */
async function customersAddedSince(before: { id: string }[]) {
  return (await savedCustomers()).filter(
    (customer) => !before.some(({ id }) => id === customer.id),
  );
}

export function savedInvoices() {
  return testDb.query.invoices.findMany({
    where: eq(schema.invoices.businessId, TEST_BUSINESS_ID),
  });
}

/** A $200 line with 25% off and $20 delivery: $170.00 in total, $15.45 of it GST. */
export async function fillTotalsExample(page: Page) {
  await replaceText(page.getByLabel("Line 1 name"), "Widget");
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

export function invoiceFormTests(form: InvoiceFormRoute) {
  test.describe(form.name, () => {
    test.describe("customer section", form.verified("2026-09-13"), () => {
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
            await form.open(page);
            await openCustomerPicker(page);
            await page.getByPlaceholder("Search customers...").fill(query);

            await expect(page.getByRole("option", { name: /Priya Nair/ })).toBeVisible();
            await expect(page.getByRole("option", { name: /Sam Okafor/ })).toBeHidden();
          });
        }
      });

      /**
       * A customer needs only one of name, company, email or phone, so anywhere one
       * is shown has to cope with the other three being blank. They are named by
       * the first they have, in that order.
       */
      test("a customer is named by the first identity they have", async ({ page }) => {
        await seedCustomer(CUSTOMERS.acme);
        await seedCustomer({ ...CUSTOMERS.beacon, company: "" });
        await seedCustomer({ ...CUSTOMERS.cashJob, company: "   ", name: "Jo Mitchell" });
        await seedCustomer({ ...CUSTOMERS.cashJob, email: "walkup@example.com" });
        await seedCustomer(CUSTOMERS.cashJob);
        await seedCustomer({ ...CUSTOMERS.cashJob, phone: "" });
        await form.open(page);
        await openCustomerPicker(page);

        await expect(page.getByRole("option", { name: /Acme Constructions/ })).toBeVisible();
        await expect(page.getByRole("option", { name: "Priya Nair", exact: true })).toBeHidden();
        await expect(page.getByRole("option", { name: "Sam Okafor", exact: true })).toBeVisible();
        await expect(page.getByRole("option", { name: "Jo Mitchell", exact: true })).toBeVisible();
        await expect(
          page.getByRole("option", { name: "walkup@example.com", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("option", { name: "0433 777 888", exact: true })).toBeVisible();
        await expect(
          page.getByRole("option", { name: "Unnamed customer", exact: true }),
        ).toBeVisible();

        await page.getByRole("option", { name: "0433 777 888", exact: true }).click();
        await expect(customerDetailsField(page, "Phone")).toHaveValue("0433 777 888");
        await expect(customerDetailsSection(page).getByRole("combobox")).toHaveText(/0433 777 888/);
      });

      test("a search matching nobody still offers to create one", async ({ page }) => {
        await seedCustomer(CUSTOMERS.acme);
        await form.open(page);
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
        await form.open(page);
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
            await form.open(page);
            await openCustomerPicker(page);
            await page.getByPlaceholder("Search customers...").fill(query);
            await expect(
              page.getByRole("option", { name: `New customer “${query}”` }),
            ).toBeVisible();
            await page.getByRole("option", { name: /^New customer/ }).click();

            await expect(customerDetailsField(page, field)).toHaveValue(query);
            await expect(customerDetailsField(page, field)).toBeFocused();
            for (const other of ["Name", "Company", "Phone", "Email"].filter((f) => f !== field)) {
              await expect(customerDetailsField(page, other)).toHaveValue("");
            }
            await expect(customerDetailsSection(page).getByRole("combobox")).toHaveText(
              "New customer",
            );
          });
        }

        test("starts with empty fields when selected from an empty search", async ({ page }) => {
          await form.open(page);
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
          await form.open(page);
          const before = await savedCustomers();
          await startNewCustomer(page, "Kelly Brooks");
          await customerDetailsField(page, "Company").fill("Brooks Joinery");
          await replaceText(page.getByLabel("Line 1 name"), "Callout fee");
          await fillAndCommit(page.getByLabel("Line 1 unit price"), "150.00");

          expect(await customersAddedSince(before)).toEqual([]);

          await saveInvoice(page).click();
          await form.saved(page);
          expect(await customersAddedSince(before)).toMatchObject([
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
          await form.open(page);

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
          const customer = await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);

          await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");
          await customerDetailsField(page, "Email").click();

          expect(await savedCustomer(customer.id)).toMatchObject({ phone: "02 9111 2222" });
        });

        test("a status shows when they have been edited", async ({ page }) => {
          await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);
          await expect(editedMenu(page)).toBeHidden();

          await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");
          await expect(editedMenu(page)).toBeVisible();

          await replaceText(customerDetailsField(page, "Phone"), "02 9111 2222");
          await expect(editedMenu(page)).toBeHidden();
        });

        test("edits can be saved to the customer", async ({ page }) => {
          const customer = await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);
          await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");

          await editedMenu(page).click();
          await expect(page.getByRole("menuitem", { name: "Update saved customer" })).toBeVisible();
          await expect(page.getByRole("menuitem", { name: "Reset to saved" })).toBeVisible();
          await expect(page.getByRole("menuitem", { name: /Save as new/ })).toBeHidden();
          await page.getByRole("menuitem", { name: "Update saved customer" }).click();

          await expect(customerDetailsFlash(page)).toHaveText("Updated");
          await expect(editedMenu(page)).toBeHidden();
          expect(await savedCustomer(customer.id)).toMatchObject({ phone: "02 9333 4444" });
        });

        test("edits can be reset", async ({ page }) => {
          const customer = await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);
          await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");

          await editedMenu(page).click();
          await page.getByRole("menuitem", { name: "Reset to saved" }).click();

          await expect(customerDetailsField(page, "Phone")).toHaveValue("02 9111 2222");
          await expect(editedMenu(page)).toBeHidden();
          expect(await savedCustomer(customer.id)).toMatchObject({ phone: "02 9111 2222" });
        });

        test("unsaved edits are prompted to be saved when the invoice is saved", async ({
          page,
        }) => {
          const customer = await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await fillMinimalInvoice(page, /Priya Nair/);
          await replaceText(customerDetailsField(page, "Phone"), "02 9333 4444");

          await saveInvoice(page).click();

          await expect(updateCustomerPrompt(page)).toBeVisible();
          await expect(updateCustomerPrompt(page)).toContainText("Acme Constructions");
          await updateCustomerPrompt(page).getByRole("button", { name: "Update customer" }).click();

          await form.saved(page);
          expect(await savedCustomer(customer.id)).toMatchObject({ phone: "02 9333 4444" });
        });
      });

      test("needs at least one of name, company, phone or email", async ({ page }) => {
        await form.open(page);
        const before = await savedCustomers();
        await startNewCustomer(page);

        await replaceText(page.getByLabel("Line 1 name"), "Callout fee");
        await saveInvoice(page).click();

        await expect(page.getByText("Select a customer to bill.")).toBeVisible();
        expect(await customersAddedSince(before)).toEqual([]);
      });

      test.describe("switching customer", () => {
        test("from a saved or new customer to another saved customer resets every field and fills in their details", async ({
          page,
        }) => {
          await seedCustomer(CUSTOMERS.acme);
          await seedCustomer(CUSTOMERS.cashJob);
          await form.open(page);

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
          await seedCustomer(CUSTOMERS.acme);
          await form.open(page);

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
          await seedCustomer(CUSTOMERS.acme);
          await form.open(page);

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
          await form.open(page);
          await startNewCustomer(page, "Kelly Brooks");

          await page.getByLabel("Billing address search").fill("Cartwright");
          await page
            .getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" })
            .click();

          await expect(addressInput(page, "Billing")).toHaveValue(
            "6097 Cartwright Track, North Eve ACT 0897",
          );
        });

        test("can be typed out instead of looked up", async ({ page }) => {
          await form.open(page);
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
          await form.open(page);
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

        test("still looks up addresses from its first line while in manual mode", async ({
          page,
        }) => {
          await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);

          await addressInput(page, "Billing").click();
          await page.getByLabel("Billing address line 1").fill("Cartwright");
          await page
            .getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" })
            .click();

          await expect(page.getByLabel("Billing suburb")).toHaveValue("North Eve");
          await expect(page.getByLabel("Billing postcode")).toHaveValue("0897");
        });
      });

      test.describe("the delivery address", () => {
        test("defaults to off", async ({ page }) => {
          await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);

          await expect(deliveryCheckbox(page)).not.toBeChecked();
          await expect(addressInput(page, "Delivery")).toBeHidden();
        });

        test("defaults to the billing address", async ({ page }) => {
          await seedCustomer(CUSTOMERS.beacon);
          await form.open(page);
          await pickCustomer(page, /Sam Okafor/);
          await deliveryCheckbox(page).check();

          await expect(
            customerDetailsSection(page).getByText("Same as billing address"),
          ).toBeVisible();
        });

        test("defaults to a separate address when the customer has one", async ({ page }) => {
          await seedCustomer(CUSTOMERS.acme);
          await form.open(page);
          await pickCustomer(page, /Priya Nair/);
          await deliveryCheckbox(page).check();

          await expect(
            customerDetailsSection(page).getByText("Same as billing address"),
          ).toBeHidden();
          await expect(addressInput(page, "Delivery")).toHaveValue(
            "88 Depot Lane, Alexandria NSW 2015",
          );
        });

        test("can be switched between billing and its own address", async ({ page }) => {
          await seedCustomer(CUSTOMERS.beacon);
          await form.open(page);
          await pickCustomer(page, /Sam Okafor/);
          await deliveryCheckbox(page).check();

          await customerDetailsSection(page)
            .getByRole("button", { name: "Use different address" })
            .click();
          await expect(
            customerDetailsSection(page).getByText("Same as billing address"),
          ).toBeHidden();
          await expect(page.getByLabel("Delivery address search")).toBeVisible();

          await customerDetailsSection(page)
            .getByRole("button", { name: "Use billing address" })
            .click();
          await expect(
            customerDetailsSection(page).getByText("Same as billing address"),
          ).toBeVisible();
        });
      });
    });

    test.describe("invoice metadata section", form.verified("2026-09-13"), () => {
      test.describe("the terms decide the due date", () => {
        for (const { terms, days } of [
          { terms: "Due on receipt", days: 0 },
          { terms: "Net 7", days: 7 },
          { terms: "Net 14", days: 14 },
          { terms: "Net 30", days: 30 },
        ]) {
          test(`${terms} is due ${days} days after issue`, async ({ page }) => {
            await form.open(page);
            await setTerms(page, terms);
            const issued = await page.getByLabel("Issue date").inputValue();
            await expect(dueDateText(page)).toHaveText(formatIsoDate(addDaysIso(issued, days)));
          });
        }
      });

      test("custom terms hand the due date over to be set", async ({ page }) => {
        await form.open(page);
        await expect(dueDateText(page)).toBeVisible();

        await setTerms(page, "Custom");
        await page.getByLabel("Due date").fill("2026-12-01");
        await expect(page.getByLabel("Due date")).toHaveValue("2026-12-01");
      });

      test("changing the issue date moves the due date with it", async ({ page }) => {
        await form.open(page);
        await setTerms(page, "Net 7");
        await page.getByLabel("Issue date").fill("2026-01-31");

        await expect(dueDateText(page)).toHaveText(formatIsoDate("2026-02-07"));
      });
    });

    test.describe("items section", form.verified("2026-09-13"), () => {
      test("an initial line is ready to type into", async ({ page }) => {
        await seedCatalog();
        await form.open(page);

        await replaceText(page.getByLabel("Line 1 name"), "Emergency callout, after hours");
        await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
        await fillAndCommit(page.getByLabel("Line 1 unit price"), "185");

        await expect(page.getByLabel("Line 1 name")).toHaveValue("Emergency callout, after hours");
        await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$185.00");
        await expect(lineSubtotal(page, 1)).toHaveText("$370.00");
      });

      test("a SKU finds its catalog item", async ({ page }) => {
        await seedCatalog();
        await form.open(page);

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
        await form.open(page);

        await replaceText(page.getByLabel("Line 1 name"), "Labour");
        await page.getByRole("button", { name: /Labour \(per hour\)/ }).click();

        await expect(page.getByLabel("Line 1 SKU")).toHaveValue("LAB-HR");
        await expect(page.getByLabel("Line 1 unit price")).toHaveValue("$120.00");
      });

      test("changing a line never edits the catalog item", async ({ page }) => {
        await seedCatalog();
        await form.open(page);

        await page.getByLabel("Line 1 SKU").fill("LAB-HR");
        await page.getByRole("button", { name: /Labour \(per hour\)/ }).click();
        await replaceText(page.getByLabel("Line 1 name"), "Labour, weekend rate");
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
        await form.open(page);

        await replaceText(page.getByLabel("Line 1 name"), "Copper pipe");
        await fillAndCommit(page.getByLabel("Line 1 unit price"), "10.50");
        await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
        await expect(lineSubtotal(page, 1)).toHaveText("$31.50");

        await fillAndCommit(page.getByLabel("Line 1 quantity"), "4");
        await expect(lineSubtotal(page, 1)).toHaveText("$42.00");
      });

      test("the line subtotal is calculated, never typed", async ({ page }) => {
        await form.open(page);

        await replaceText(page.getByLabel("Line 1 name"), "Copper pipe");
        await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
        await fillAndCommit(page.getByLabel("Line 1 unit price"), "60");

        await expect(lineSubtotal(page, 1)).toHaveText("$120.00");
        await expect(page.getByLabel("Line 1 subtotal")).toHaveCount(0);
      });

      test("a line quantity takes any amount above 0, to three decimal places", async ({
        page,
      }) => {
        await form.open(page);
        await expectAccepted(page.getByLabel("Line 1 quantity", { exact: true }), [
          { typed: "2.50", shows: "2.5" },
          { typed: "0.001", shows: "0.001" },
          { typed: "1.234", shows: "1.234" },
          { typed: "1,000", shows: "1000" },
        ]);
      });

      test("a line quantity refuses anything else", async ({ page }) => {
        await form.open(page);
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
        await form.open(page);
        await expectAccepted(page.getByLabel("Line 1 unit price", { exact: true }), MONEY.accepts);
      });

      test("a unit price refuses anything else", async ({ page }) => {
        await form.open(page);
        await expectRefused(
          page,
          page.getByLabel("Line 1 unit price", { exact: true }),
          MONEY.refuses,
          "Line 1 unit price",
        );
      });

      test("adding a new line starts with empty fields ready to type into", async ({ page }) => {
        await form.open(page);

        await page.getByRole("button", { name: "Add item" }).click();

        await expect(page.getByLabel("Line 2 SKU")).toBeVisible();
        await expect(page.getByLabel("Line 2 SKU")).toBeFocused();
      });

      test("a line can be removed", async ({ page }) => {
        await form.open(page);

        await replaceText(page.getByLabel("Line 1 name"), "First");
        await page.getByRole("button", { name: "Add item" }).click();
        await page.getByLabel("Line 2 name").fill("Second");
        await page.getByRole("button", { name: "Remove line 1" }).click();

        expect(await lineNames(page)).toEqual(["Second"]);
      });

      test("the last line cannot be removed", async ({ page }) => {
        await form.open(page);
        await expect(page.getByRole("button", { name: "Remove line 1" })).toBeDisabled();

        await page.getByRole("button", { name: "Add item" }).click();
        await expect(page.getByRole("button", { name: "Remove line 1" })).toBeEnabled();
      });

      test("a line can be moved up and down", async ({ page }) => {
        test.fixme();
        await form.open(page);

        await replaceText(page.getByLabel("Line 1 name"), "First");
        await page.getByRole("button", { name: "Add item" }).click();
        await page.getByLabel("Line 2 name").fill("Second");

        await page.getByRole("button", { name: "Move line 2 up" }).click();
        expect(await lineNames(page)).toEqual(["Second", "First"]);

        await page.getByRole("button", { name: "Move line 1 down" }).click();
        expect(await lineNames(page)).toEqual(["First", "Second"]);
      });
    });

    test.describe("balance section", form.verified("2026-09-14"), () => {
      test("notes can be written on the invoice", async ({ page }) => {
        await form.open(page);
        await page.getByLabel("Notes").fill("Please pay by bank transfer.");
        await expect(page.getByLabel("Notes")).toHaveValue("Please pay by bank transfer.");
      });

      test("the subtotal is the sum of the line subtotals", async ({ page }) => {
        await form.open(page);
        await replaceText(page.getByLabel("Line 1 name"), "Widget");
        await fillAndCommit(page.getByLabel("Line 1 quantity"), "2");
        await fillAndCommit(page.getByLabel("Line 1 unit price"), "100");
        await page.getByRole("button", { name: "Add item" }).click();
        await page.getByLabel("Line 2 name").fill("Labour");
        await fillAndCommit(page.getByLabel("Line 2 unit price"), "120");

        await expect(totalsAmount(page, "Subtotal")).toHaveText("$320.00");
      });

      test("a discount can be added", async ({ page }) => {
        await form.open(page);
        await replaceText(page.getByLabel("Line 1 name"), "Widget");
        await fillAndCommit(page.getByLabel("Line 1 unit price"), "200");
        await expect(page.getByLabel("Discount percent")).toBeHidden();

        await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
        await fillAndCommit(page.getByLabel("Discount percent"), "10");

        await expect(totalsAmount(page, "Discount")).toHaveText("-$20.00");
      });

      test("a discount is a percentage or an amount", async ({ page }) => {
        await form.open(page);
        await replaceText(page.getByLabel("Line 1 name"), "Widget");
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
        await form.open(page);
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
        await form.open(page);
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
        await form.open(page);
        await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
        await expect(page.getByLabel("Discount percent")).toBeVisible();

        await totalsPanel(page).getByRole("button", { name: "Remove discount" }).click();
        await expect(page.getByLabel("Discount percent")).toBeHidden();
        await expect(totalsPanel(page).getByRole("button", { name: "Add discount" })).toBeVisible();
      });

      test("delivery takes any amount of $0 or more, to the cent", async ({ page }) => {
        await form.open(page);
        await expectAccepted(page.getByLabel("Delivery", { exact: true }), MONEY.accepts);
      });

      test("delivery refuses anything else", async ({ page }) => {
        await form.open(page);
        await expectRefused(page, page.getByLabel("Delivery", { exact: true }), MONEY.refuses);
      });

      test("the total is the subtotal less the discount, plus delivery", async ({ page }) => {
        await form.open(page);
        await fillTotalsExample(page);

        await expect(totalsAmount(page, "Subtotal")).toHaveText("$200.00");
        await expect(totalsAmount(page, "Discount")).toHaveText("-$50.00");
        await expect(totalsAmount(page, "Total")).toHaveText("$170.00");
      });

      test("the GST shown is the total divided by 11", async ({ page }) => {
        await form.open(page);
        await fillTotalsExample(page);

        await expect(totalsAmount(page, "Total")).toHaveText("$170.00");
        await expect(totalsAmount(page, "Includes GST (10%)")).toHaveText("$15.45");
      });
    });

    test.describe("amount field errors", form.verified("2026-09-14"), () => {
      test("the error follows the text as it is corrected", async ({ page }) => {
        await form.open(page);
        const quantity = page.getByLabel("Line 1 quantity");
        await fillAndCommit(quantity, "1.2345");
        await expect(
          page.getByText("Line 1 quantity: Use at most 3 decimal places."),
        ).toBeVisible();

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
        await form.open(page);
        await page.getByRole("button", { name: "Add item" }).click();
        await fillAndCommit(page.getByLabel("Line 2 quantity"), "1.2345");
        await expect(saveStatus(page)).toHaveText("Fix the field above");

        await page.getByRole("button", { name: "Remove line 2" }).click();

        await expect(page.getByText(/^Line 2 quantity:/)).toBeHidden();
        await expect(saveStatus(page)).toHaveText("Draft");
      });
    });

    test.describe("the action bar", form.verified("2026-09-14"), () => {
      test("saving is refused if an error is present", async ({ page }) => {
        await seedCustomer(CUSTOMERS.acme);
        await form.open(page);
        const before = await savedInvoices();
        await fillMinimalInvoice(page, /Priya Nair/);
        await fillAndCommit(page.getByLabel("Line 1 quantity"), "1.2345");
        await fillAndCommit(page.getByLabel("Delivery", { exact: true }), "-5");

        await saveInvoice(page).click();
        await expect(saveStatus(page)).toHaveText("Fix 2 fields above");
        expect(await savedInvoices()).toEqual(before);

        await fillAndCommit(page.getByLabel("Delivery", { exact: true }), "5");
        await expect(saveStatus(page)).toHaveText("Fix the field above");
        await fillAndCommit(page.getByLabel("Line 1 quantity"), "1.5");
        await expect(saveStatus(page)).toHaveText("Draft");

        await saveInvoice(page).click();
        await form.saved(page);
        await expect(page.getByLabel("Line 1 quantity")).toHaveValue("1.5");
      });
    });
  });
}
