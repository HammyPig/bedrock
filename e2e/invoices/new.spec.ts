import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { computeTotals } from "~/app/invoices/_lib/money";
import { addDaysIso, formatIsoDate, todayIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { billTo, draft, line, payment } from "../support/drafts";
import { CUSTOMERS, ITEMS, seedCatalog, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  actionBar,
  addressInput,
  balanceDue,
  billToField,
  billToFlash,
  billToSection,
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

test.beforeEach(async () => {
  await resetBusinessData();
});

function savedCustomers() {
  return testDb.query.customers.findMany({
    where: eq(schema.customers.businessId, TEST_BUSINESS_ID),
  });
}

function payableInvoice() {
  return seedInvoice(draft({ invoiceNumber: "INV-0900", lineItems: [line()] }));
}

test.describe("customer section", () => {
  /**
   * Every invoice has a customer, so assigning one is the first thing the form
   * asks for. It is done through a search: either an existing customer is clicked
   * or a new one is deliberately chosen.
   */
  test("opens as a search and nothing else", async ({ page }) => {
    await gotoNewInvoice(page);

    const picker = billToSection(page).getByRole("combobox");
    await expect(picker).toBeVisible();
    await expect(picker).toHaveText("Search customers...");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(billToField(page, "Name")).toBeHidden();
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
    await expect(billToField(page, "Phone")).toHaveValue("0433 777 888");
    await expect(billToSection(page).getByRole("combobox")).toHaveText(/0433 777 888/);
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

        await expect(billToField(page, field)).toHaveValue(query);
        await expect(billToField(page, field)).toBeFocused();
        for (const other of ["Name", "Company", "Phone", "Email"].filter((f) => f !== field)) {
          await expect(billToField(page, other)).toHaveValue("");
        }
        await expect(billToSection(page).getByRole("combobox")).toHaveText("New customer");
      });
    }

    test("starts with empty fields when selected from an empty search", async ({ page }) => {
      await gotoNewInvoice(page);
      await openCustomerPicker(page);
      await page.getByRole("option", { name: "New customer", exact: true }).click();

      await expect(billToField(page, "Name")).toBeVisible();
      await expect(billToField(page, "Name")).toHaveValue("");
      await expect(billToField(page, "Name")).toBeFocused();
    });

    /**
     * There is no reason to write a customer down until the invoice is finalised,
     * so nothing is created before the save and an invoice abandoned half-filled
     * leaves nobody behind.
     */
    test("is only saved when the invoice is saved", async ({ page }) => {
      await gotoNewInvoice(page);
      await startNewCustomer(page, "Kelly Brooks");
      await billToField(page, "Company").fill("Brooks Joinery");
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

      await expect(billToField(page, "Name")).toHaveValue("Priya Nair");
      await expect(billToField(page, "Company")).toHaveValue("Acme Constructions");
      await expect(billToField(page, "Phone")).toHaveValue("02 9111 2222");
      await expect(billToField(page, "Email")).toHaveValue("priya@acme.example");
      await expect(addressInput(page, "Billing")).toHaveValue(
        "14 Wharf Road, Level 3, Pyrmont NSW 2009",
      );
      await expect(billToField(page, "Name")).toBeEditable();
      await expect(editedMenu(page)).toBeHidden();
    });

    test("editing them changes the invoice, not their record", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);

      await replaceText(billToField(page, "Phone"), "02 9333 4444");
      await billToField(page, "Email").click();

      expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
    });

    test("a status shows when they have been edited", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await expect(editedMenu(page)).toBeHidden();

      await replaceText(billToField(page, "Phone"), "02 9333 4444");
      await expect(editedMenu(page)).toBeVisible();

      await replaceText(billToField(page, "Phone"), "02 9111 2222");
      await expect(editedMenu(page)).toBeHidden();
    });

    test("edits can be saved to the customer", async ({ page }) => {
      const customer = await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await replaceText(billToField(page, "Phone"), "02 9333 4444");

      await editedMenu(page).click();
      await expect(page.getByRole("menuitem", { name: "Update saved customer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Reset to saved" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /Save as new/ })).toBeHidden();
      await page.getByRole("menuitem", { name: "Update saved customer" }).click();

      await expect(billToFlash(page)).toHaveText("Updated");
      await expect(editedMenu(page)).toBeHidden();
      expect(await savedCustomers()).toMatchObject([{ id: customer.id, phone: "02 9333 4444" }]);
    });

    test("edits can be reset", async ({ page }) => {
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await replaceText(billToField(page, "Phone"), "02 9333 4444");

      await editedMenu(page).click();
      await page.getByRole("menuitem", { name: "Reset to saved" }).click();

      await expect(billToField(page, "Phone")).toHaveValue("02 9111 2222");
      await expect(editedMenu(page)).toBeHidden();
      expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
    });

    test("unsaved edits are prompted to be saved when the invoice is saved", async ({ page }) => {
      const customer = await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await fillMinimalInvoice(page, /Priya Nair/);
      await replaceText(billToField(page, "Phone"), "02 9333 4444");

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

  test.describe("the email field", () => {
    /**
     * Addresses are bubbles rather than one comma-separated string so it is plain
     * that an invoice can go to more than one of them.
     */
    test("turns each address into a bubble", async ({ page }) => {
      test.fixme();
      await gotoNewInvoice(page);
      await startNewCustomer(page, "Kelly Brooks");

      await billToField(page, "Email").fill("kelly@brooks.example");
      await page.keyboard.press("Space");
      await expect(
        billToSection(page).getByRole("button", { name: "Remove kelly@brooks.example" }),
      ).toBeVisible();
      await expect(billToField(page, "Email")).toHaveValue("");

      await billToField(page, "Email").fill("accounts@brooks.example");
      await page.keyboard.press("Space");
      await expect(
        billToSection(page).getByRole("button", { name: "Remove accounts@brooks.example" }),
      ).toBeVisible();
    });

    test("takes an address back out again", async ({ page }) => {
      test.fixme();
      await gotoNewInvoice(page);
      await startNewCustomer(page, "Kelly Brooks");

      await billToField(page, "Email").fill("kelly@brooks.example");
      await page.keyboard.press("Space");
      await billToSection(page)
        .getByRole("button", { name: "Remove kelly@brooks.example" })
        .click();

      await expect(
        billToSection(page).getByRole("button", { name: "Remove kelly@brooks.example" }),
      ).toBeHidden();
    });
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
      await expect(billToField(page, "Phone")).toHaveValue("0433 777 888");
      await expect(billToField(page, "Name")).toHaveValue("");
      await expect(billToField(page, "Company")).toHaveValue("");
      await expect(billToField(page, "Email")).toHaveValue("");
      await expect(page.getByLabel("Billing address search")).toBeVisible();
      await expect(deliveryCheckbox(page)).not.toBeChecked();

      await startNewCustomer(page, "Kelly Brooks");
      await deliveryCheckbox(page).check();

      await pickCustomer(page, /Priya Nair/);
      await expect(billToField(page, "Name")).toHaveValue("Priya Nair");
      await expect(billToField(page, "Company")).toHaveValue("Acme Constructions");
      await expect(billToField(page, "Email")).toHaveValue("priya@acme.example");
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
        await expect(billToField(page, field)).toHaveValue("");
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
      await billToField(page, "Company").fill("Brooks Joinery");
      await deliveryCheckbox(page).check();

      await startNewCustomer(page);
      await expect(billToField(page, "Name")).toHaveValue("Kelly Brooks");
      await expect(billToField(page, "Company")).toHaveValue("Brooks Joinery");
      await expect(deliveryCheckbox(page)).toBeChecked();

      await pickCustomer(page, /Priya Nair/);
      await replaceText(billToField(page, "Phone"), "02 9333 4444");
      await deliveryCheckbox(page).check();

      await pickCustomer(page, /Priya Nair/);
      await expect(billToField(page, "Phone")).toHaveValue("02 9333 4444");
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

      await billToField(page, "Company").click();
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

      await billToField(page, "Company").click();
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

      await expect(billToSection(page).getByText("Same as billing address")).toBeVisible();
    });

    test("defaults to a separate address when the customer has one", async ({ page }) => {
      test.fixme();
      await seedCustomer(CUSTOMERS.acme);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Priya Nair/);
      await deliveryCheckbox(page).check();

      await expect(billToSection(page).getByText("Same as billing address")).toBeHidden();
      await expect(addressInput(page, "Delivery")).toHaveValue(
        "88 Depot Lane, Alexandria NSW 2015",
      );
    });

    test("can be switched between billing and its own address", async ({ page }) => {
      await seedCustomer(CUSTOMERS.beacon);
      await gotoNewInvoice(page);
      await pickCustomer(page, /Sam Okafor/);
      await deliveryCheckbox(page).check();

      await billToSection(page).getByRole("button", { name: "Use different address" }).click();
      await expect(billToSection(page).getByText("Same as billing address")).toBeHidden();
      await expect(page.getByLabel("Delivery address search")).toBeVisible();

      await billToSection(page).getByRole("button", { name: "Use billing address" }).click();
      await expect(billToSection(page).getByText("Same as billing address")).toBeVisible();
    });
  });
});

test.describe("invoice metadata section", () => {
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

  // test.describe("the invoice number", { tag: "@tbd" }, () => {
  //   test("follows the business's numbering", async ({ page }) => {
  //     await gotoNewInvoice(page);
  //     await expect(page.getByLabel("Invoice no.")).toHaveValue("INV-1001");
  //   });

  //   test("is called out while a number already in use is typed", async ({ page }) => {
  //     test.fixme();
  //     await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  //     await gotoNewInvoice(page);

  //     await replaceText(page.getByLabel("Invoice no."), "INV-0900");
  //     await expect(page.getByText("Invoice number INV-0900 already exists.")).toBeVisible();
  //   });

  //   test("stops being called out once the number is free again", async ({ page }) => {
  //     test.fixme();
  //     await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  //     await gotoNewInvoice(page);

  //     const number = page.getByLabel("Invoice no.");
  //     await replaceText(number, "INV-0900");
  //     await expect(page.getByText("Invoice number INV-0900 already exists.")).toBeVisible();

  //     await replaceText(number, "INV-0901");
  //     await expect(page.getByText(/already exists/)).toBeHidden();
  //   });

  //   test("is never called out against the invoice's own number", async ({ page }) => {
  //     test.fixme();
  //     const invoice = await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await replaceText(page.getByLabel("Invoice no."), "INV-0900");
  //     await expect(page.getByText(/already exists/)).toBeHidden();
  //   });

  //   test("is refused on save when it is already in use", async ({ page }) => {
  //     await seedCustomer(CUSTOMERS.acme);
  //     await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
  //     await gotoNewInvoice(page);

  //     await fillMinimalInvoice(page, /Priya Nair/);
  //     await replaceText(page.getByLabel("Invoice no."), "INV-0900");
  //     await saveInvoice(page).click();

  //     await expect(saveStatus(page)).toHaveText("Invoice number INV-0900 already exists.");
  //   });
  // });

  // test.describe("the document type", { tag: "@tbd" }, () => {
  //   test("the document can be issued as a quote instead", async ({ page }) => {
  //     await gotoNewInvoice(page);
  //     await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();

  //     await documentType(page).getByRole("button", { name: "Quote" }).click();
  //     await expect(page.getByRole("heading", { name: "New quote" })).toBeVisible();
  //   });

  //   test("a quote asks for a quote number", async ({ page }) => {
  //     await gotoNewInvoice(page);
  //     await expect(page.getByLabel("Invoice no.")).toBeVisible();

  //     await documentType(page).getByRole("button", { name: "Quote" }).click();
  //     await expect(page.getByLabel("Quote no.")).toHaveValue("INV-1001");
  //     await expect(page.getByLabel("Invoice no.")).toBeHidden();
  //   });

  //   test("a quote is not payable", async ({ page }) => {
  //     const quote = await seedInvoice(draft({ documentType: "quote", invoiceNumber: "QUO-0001" }));
  //     const invoice = await seedInvoice(draft({ invoiceNumber: "INV-0900" }));

  //     await page.goto(`/invoices/${quote.id}/edit`);
  //     await expect(page.getByRole("button", { name: "Record full payment" })).toBeHidden();

  //     await page.goto(`/invoices/${invoice.id}/edit`);
  //     await expect(page.getByRole("button", { name: "Record full payment" })).toBeVisible();
  //   });

  //   test("the document type survives a save", async ({ page }) => {
  //     await seedCustomer(CUSTOMERS.acme);
  //     await gotoNewInvoice(page);

  //     await fillMinimalInvoice(page, /Priya Nair/);
  //     await documentType(page).getByRole("button", { name: "Quote" }).click();
  //     await saveNewInvoice(page);
  //     await expect(saveStatus(page)).toHaveText("Saved");

  //     await page.reload();
  //     await expect(page.getByLabel("Quote no.")).toBeVisible();
  //   });

  //   test("a saved quote can become an invoice", async ({ page }) => {
  //     await seedCustomer(CUSTOMERS.acme);
  //     const quote = await seedInvoice(
  //       draft({ documentType: "quote", invoiceNumber: "QUO-0001", lineItems: [line()] }),
  //     );

  //     await page.goto(`/invoices/${quote.id}/edit`);
  //     await documentType(page).getByRole("button", { name: "Invoice" }).click();
  //     await saveInvoice(page).click();
  //     await expect(saveStatus(page)).toHaveText("Saved");

  //     await page.reload();
  //     await expect(page.getByLabel("Invoice no.")).toBeVisible();
  //     await expect(page.getByRole("button", { name: "Record full payment" })).toBeVisible();
  //   });
  // });
});

test.describe("items section", () => {
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

  test.describe("the optional columns", () => {
    test("discounts are opt-in", async ({ page }) => {
      await gotoNewInvoice(page);
      await expect(page.getByLabel("Line 1 discount percent")).toBeHidden();

      await page.getByRole("button", { name: "Discounts" }).click();
      await expect(page.getByLabel("Line 1 discount percent")).toBeVisible();

      await page.getByRole("button", { name: "Discounts" }).click();
      await expect(page.getByLabel("Line 1 discount percent")).toBeHidden();
    });

    test("a line discount comes off its subtotal", async ({ page }) => {
      await gotoNewInvoice(page);
      await page.getByRole("button", { name: "Discounts" }).click();

      await page.getByLabel("Line 1 name").fill("Copper pipe");
      await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
      await fillAndCommit(page.getByLabel("Line 1 unit price"), "42.50");
      await fillAndCommit(page.getByLabel("Line 1 discount percent"), "10");

      await expect(lineSubtotal(page, 1)).toHaveText("$114.75");
    });

    /**
     * Backordered is a toggle rather than a count because a part-filled order is
     * split into two lines — the x that shipped and the y that did not — instead
     * of one line reading x of y.
     */
    test("backorders are opt-in", async ({ page }) => {
      await gotoNewInvoice(page);
      await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeHidden();

      await page.getByRole("button", { name: "Backorders" }).click();
      await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeVisible();

      await page.getByRole("button", { name: "Backorders" }).click();
      await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeHidden();
    });

    test("a discount an invoice already uses starts open", async ({ page }) => {
      const invoice = await seedInvoice(
        draft({ lineItems: [line({ name: "Discounted", discountPercent: 10 })] }),
      );
      await page.goto(`/invoices/${invoice.id}/edit`);

      await expect(page.getByLabel("Line 1 discount percent")).toHaveValue("10");
      await expect(page.getByRole("button", { name: "Discounts" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("a backorder an invoice already uses starts open", async ({ page }) => {
      const invoice = await seedInvoice(
        draft({ lineItems: [line({ name: "On order", backordered: true })] }),
      );
      await page.goto(`/invoices/${invoice.id}/edit`);

      await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeChecked();
      await expect(page.getByRole("button", { name: "Backorders" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("discounts in use say why they will not close", async ({ page }) => {
      test.fixme();
      const invoice = await seedInvoice(
        draft({ lineItems: [line({ name: "Discounted", discountPercent: 10 })] }),
      );
      await page.goto(`/invoices/${invoice.id}/edit`);

      await page.getByRole("button", { name: "Discounts" }).click();
      await expect(page.getByText("Clear the discounts on each line first.")).toBeVisible();
      await expect(page.getByLabel("Line 1 discount percent")).toBeVisible();
    });

    test("backorders in use say why they will not close", async ({ page }) => {
      test.fixme();
      const invoice = await seedInvoice(
        draft({ lineItems: [line({ name: "On order", backordered: true })] }),
      );
      await page.goto(`/invoices/${invoice.id}/edit`);

      await page.getByRole("button", { name: "Backorders" }).click();
      await expect(page.getByText("Clear the backorders on each line first.")).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Line 1 backordered" })).toBeVisible();
    });
  });
});

test.describe("balance section", () => {
  test("notes can be written on the invoice", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Notes").fill("Please pay by bank transfer.");
    await expect(page.getByLabel("Notes")).toHaveValue("Please pay by bank transfer.");
  });

  test("the subtotal is the sum of the lines", async ({ page }) => {
    await gotoNewInvoice(page);
    await page.getByLabel("Line 1 name").fill("Widget");
    await fillAndCommit(page.getByLabel("Line 1 unit price"), "100");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByLabel("Line 2 name").fill("Labour");
    await fillAndCommit(page.getByLabel("Line 2 unit price"), "120");

    await expect(totalsAmount(page, "Subtotal")).toHaveText("$220.00");
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

  test("a discount can be taken off again", async ({ page }) => {
    await gotoNewInvoice(page);
    await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
    await expect(page.getByLabel("Discount percent")).toBeVisible();

    await totalsPanel(page).getByRole("button", { name: "Remove discount" }).click();
    await expect(page.getByLabel("Discount percent")).toBeHidden();
    await expect(totalsPanel(page).getByRole("button", { name: "Add discount" })).toBeVisible();
  });

  // test("a delivery cost is added before GST", { tag: "@tbd" }, async ({ page }) => {
  //   await gotoNewInvoice(page);
  //   await page.getByLabel("Line 1 name").fill("Widget");
  //   await fillAndCommit(page.getByLabel("Line 1 unit price"), "100");
  //   await fillAndCommit(page.getByLabel("Freight"), "20");

  //   await expect(totalsAmount(page, "GST")).toHaveText("$12.00");
  // });

  // test("the total is what the invoice comes to", { tag: "@tbd" }, async ({ page }) => {
  //   await gotoNewInvoice(page);
  //   await page.getByLabel("Line 1 name").fill("Widget");
  //   await fillAndCommit(page.getByLabel("Line 1 unit price"), "100");
  //   await fillAndCommit(page.getByLabel("Freight"), "20");

  //   await expect(totalsAmount(page, "Total")).toHaveText("$132.00");
  // });

  // test("the balance shown is the balance calculated", async ({ page }) => {
  //   await gotoNewInvoice(page);
  //   await page.getByLabel("Line 1 name").fill("Widget");
  //   await fillAndCommit(page.getByLabel("Line 1 quantity"), "3");
  //   await fillAndCommit(page.getByLabel("Line 1 unit price"), "19.99");
  //   await totalsPanel(page).getByRole("button", { name: "Add discount" }).click();
  //   await fillAndCommit(page.getByLabel("Discount percent"), "15");
  //   await fillAndCommit(page.getByLabel("Freight"), "12.50");

  //   const expected = computeTotals({
  //     lineItems: [line({ quantity: 3, unitPriceCents: 1999 })],
  //     discount: { mode: "percent", value: 15 },
  //     freightCents: 1250,
  //     taxRatePercent: 10,
  //   });
  //   await expect(balanceDue(page)).toHaveText(formatCents(expected.balanceCents));
  // });

  // test.describe("payments", () => {
  //   test("an unsaved invoice can take one", async ({ page }) => {
  //     await seedCustomer(CUSTOMERS.acme);
  //     await gotoNewInvoice(page);
  //     await fillMinimalInvoice(page, /Priya Nair/);
  //     await expect(balanceDue(page)).toHaveText("$165.00");

  //     await page.getByRole("button", { name: "Record full payment" }).click();

  //     await expect(
  //       totalsPanel(page).getByText(`Paid ${formatIsoDate(todayIsoDate())}`),
  //     ).toBeVisible();
  //     await expect(balanceDue(page)).toHaveText("$0.00");
  //   });

  //   test("one taken before the first save is written with the invoice", async ({ page }) => {
  //     await seedCustomer(CUSTOMERS.acme);
  //     await gotoNewInvoice(page);
  //     await fillMinimalInvoice(page, /Priya Nair/);

  //     await page.getByRole("button", { name: "Record partial payment" }).click();
  //     await fillAndCommit(page.getByLabel("Payment amount"), "65");
  //     await page.getByRole("button", { name: "Record", exact: true }).click();
  //     await expect(balanceDue(page)).toHaveText("$100.00");

  //     await saveNewInvoice(page);
  //     await page.reload();

  //     await expect(totalsPanel(page).getByText("-$65.00")).toBeVisible();
  //     await expect(balanceDue(page)).toHaveText("$100.00");
  //   });

  //   test("recording one leaves the invoice unsaved until it is saved", async ({ page }) => {
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await page.getByRole("button", { name: "Record full payment" }).click();
  //     await expect(saveStatus(page)).toHaveText("Draft");

  //     await saveInvoice(page).click();
  //     await expect(saveStatus(page)).toHaveText("Saved");

  //     await page.reload();
  //     await expect(balanceDue(page)).toHaveText("$0.00");
  //   });

  //   test("the full payment is dated today for the whole balance", async ({ page }) => {
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);
  //     await expect(balanceDue(page)).toHaveText("$110.00");

  //     await page.getByRole("button", { name: "Record full payment" }).click();

  //     await expect(
  //       totalsPanel(page).getByText(`Paid ${formatIsoDate(todayIsoDate())}`),
  //     ).toBeVisible();
  //     await expect(totalsPanel(page).getByText("-$110.00")).toBeVisible();
  //     await expect(balanceDue(page)).toHaveText("$0.00");
  //   });

  //   test("part of the balance can be paid", async ({ page }) => {
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await page.getByRole("button", { name: "Record partial payment" }).click();
  //     await expect(page.getByLabel("Payment date")).toHaveValue(todayIsoDate());

  //     await fillAndCommit(page.getByLabel("Payment amount"), "40");
  //     await page.getByRole("button", { name: "Record", exact: true }).click();

  //     await expect(balanceDue(page)).toHaveText("$70.00");
  //   });

  //   test("one can be taken back off", async ({ page }) => {
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await page.getByRole("button", { name: "Record full payment" }).click();
  //     await expect(balanceDue(page)).toHaveText("$0.00");

  //     await page.getByRole("button", { name: "Delete payment" }).click();
  //     await expect(balanceDue(page)).toHaveText("$110.00");
  //   });

  //   test("a settled invoice stops asking for one", async ({ page }) => {
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await page.getByRole("button", { name: "Record full payment" }).click();
  //     await expect(balanceDue(page)).toHaveText("$0.00");

  //     await expect(page.getByRole("button", { name: "Record full payment" })).toBeHidden();
  //     await expect(page.getByRole("button", { name: "Record partial payment" })).toBeHidden();
  //   });

  //   test("one records how it was paid", async ({ page }) => {
  //     test.fixme();
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await page.getByRole("button", { name: "Record partial payment" }).click();
  //     await expect(page.getByLabel("Payment method")).toHaveValue("card");

  //     await page.getByLabel("Payment method").selectOption("bank_transfer");
  //     await fillAndCommit(page.getByLabel("Payment amount"), "40");
  //     await page.getByRole("button", { name: "Record", exact: true }).click();

  //     await expect(totalsPanel(page).getByText(/Bank transfer/)).toBeVisible();
  //   });

  //   test("a recorded one can be edited", async ({ page }) => {
  //     test.fixme();
  //     const invoice = await payableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);
  //     await page.getByRole("button", { name: "Record full payment" }).click();

  //     await page.getByRole("button", { name: "Edit payment" }).click();
  //     await page.getByLabel("Payment date").fill("2026-08-20");
  //     await page.getByLabel("Payment method").selectOption("bank_transfer");
  //     await fillAndCommit(page.getByLabel("Payment amount"), "40");
  //     await page.getByRole("button", { name: "Record", exact: true }).click();

  //     await expect(
  //       totalsPanel(page).getByText(`Paid ${formatIsoDate("2026-08-20")}`),
  //     ).toBeVisible();
  //     await expect(totalsPanel(page).getByText(/Bank transfer/)).toBeVisible();
  //     await expect(balanceDue(page)).toHaveText("$70.00");
  //   });
  // });
});

test.describe("the action bar", () => {
  test("a new invoice is a draft", async ({ page }) => {
    await gotoNewInvoice(page);
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("saving says so, and the next edit takes it back to a draft", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);

    await saveNewInvoice(page);
    await expect(saveStatus(page)).toHaveText("Saved");

    await page.getByLabel("Notes").fill("Added after saving.");
    await expect(saveStatus(page)).toHaveText("Draft");
  });

  test("a saved invoice opens as saved", async ({ page }) => {
    const invoice = await payableInvoice();
    await page.goto(`/invoices/${invoice.id}/edit`);
    await expect(saveStatus(page)).toHaveText("Saved");
  });

  test("a refused save reports why, in place of the status", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await seedInvoice(draft({ invoiceNumber: "INV-0900" }));
    await gotoNewInvoice(page);
    await fillMinimalInvoice(page, /Priya Nair/);
    await replaceText(page.getByLabel("Invoice no."), "INV-0900");

    await saveInvoice(page).click();
    await expect(saveStatus(page)).toHaveText("Invoice number INV-0900 already exists.");
    await expect(saveStatus(page)).not.toHaveText("Draft");
  });

  // test.describe("sending the invoice", { tag: "@tbd" }, () => {
  //   function emailableInvoice(email = "priya@acme.example") {
  //     return seedInvoice(
  //       draft({ invoiceNumber: "INV-0900", billTo: billTo({ email }), lineItems: [line()] }),
  //     );
  //   }

  //   async function stubSend(page: Page, sentTo = "priya@acme.example") {
  //     await page.route("**/api/trpc/invoice.sendEmail*", (route) =>
  //       route.fulfill({
  //         status: 200,
  //         contentType: "application/json",
  //         body: trpcStreamResponse({ sentTo }),
  //       }),
  //     );
  //   }

  //   test("Save + email saves first, then sends, and confirms where", async ({ page }) => {
  //     const invoice = await emailableInvoice();
  //     await stubSend(page);

  //     const sent = page.waitForRequest((request) =>
  //       request.url().includes("/api/trpc/invoice.sendEmail"),
  //     );
  //     await page.goto(`/invoices/${invoice.id}/edit`);
  //     await actionBar(page).getByRole("button", { name: "Save + email" }).click();

  //     await sent;
  //     await expect(saveStatus(page)).toHaveText("Sent to priya@acme.example");
  //   });

  //   test("it goes to every address on the invoice", async ({ page }) => {
  //     test.fixme();
  //     const invoice = await emailableInvoice("kelly@brooks.example accounts@brooks.example");
  //     await stubSend(page, "kelly@brooks.example, accounts@brooks.example");
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await actionBar(page).getByRole("button", { name: "Save + email" }).click();
  //     await expect(saveStatus(page)).toHaveText(
  //       "Sent to kelly@brooks.example, accounts@brooks.example",
  //     );
  //   });

  //   test("a customer with no email address is asked for one", async ({ page }) => {
  //     const invoice = await emailableInvoice("");
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await actionBar(page).getByRole("button", { name: "Save + email" }).click();
  //     await expect(saveStatus(page)).toHaveText(
  //       "Add an email address to the billing details first.",
  //     );
  //   });

  //   test("sending without email configured says so", async ({ page }) => {
  //     const invoice = await emailableInvoice();
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await actionBar(page).getByRole("button", { name: "Save + email" }).click();
  //     await expect(saveStatus(page)).toHaveText(
  //       "Email sending isn't configured — set RESEND_API_KEY and EMAIL_FROM.",
  //     );
  //   });

  //   test("the confirmation does not outlive the invoice it described", async ({ page }) => {
  //     const invoice = await emailableInvoice();
  //     await stubSend(page);
  //     await page.goto(`/invoices/${invoice.id}/edit`);

  //     await actionBar(page).getByRole("button", { name: "Save + email" }).click();
  //     await expect(saveStatus(page)).toHaveText("Sent to priya@acme.example");

  //     await page.getByLabel("Notes").fill("Changed after sending.");
  //     await expect(saveStatus(page)).toHaveText("Draft");
  //   });

  //   test("emailing a brand new invoice still reports what happened", async ({ page }) => {
  //     test.fail();
  //     await seedCustomer(CUSTOMERS.acme);
  //     await stubSend(page);

  //     await gotoNewInvoice(page);
  //     await fillMinimalInvoice(page, /Priya Nair/);
  //     await actionBar(page).getByRole("button", { name: "Save + email" }).click();

  //     await page.waitForURL(/\/invoices\/[^/]+\/edit$/);
  //     await expect(saveStatus(page)).toHaveText("Sent to priya@acme.example");
  //   });
  // });

  test.describe("exporting the invoice", () => {
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
      expect(text).toContain("$114.75");

      expect(text).toContain("LAB-HR");
      expect(text).toContain("Labour");
      expect(text).toContain("$120.00");
      expect(text).toContain("$240.00");

      expect(text).toContain("BACKORDERED");
      expect(text).toContain("Backordered items will ship separately.");
    });

    test("the PDF adds up the same way the form does", async ({ page }) => {
      const invoice = await loadedInvoice();
      await page.goto(`/invoices/${invoice.id}/edit`);
      const { text } = await exportPdf(page);

      expect(text).toContain("Subtotal $354.75");
      expect(text).toContain("Discount -$25.00");
      expect(text).toContain("$15.00");
      expect(text).toContain("GST (10%) $34.48");
      expect(text).toContain("Total $379.23");
    });

    test("the PDF shows what has been paid and what is left", async ({ page }) => {
      const invoice = await loadedInvoice();
      await page.goto(`/invoices/${invoice.id}/edit`);
      const { text } = await exportPdf(page);

      expect(text).toContain("Paid -$50.00");
      expect(text).toContain("Balance due $329.23");
    });
  });
});
