import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { CUSTOMERS, seedCustomer } from "../support/fixtures";
import {
  addressInput,
  billToDetail,
  billToSave,
  billToSection,
  deliveryCheckbox,
  gotoNewInvoice,
  openCustomerPicker,
  pickCustomer,
  replaceText,
  startNewCustomer,
} from "../support/invoice-page";

/**
 * C1-C18. Every invoice bills a customer, so this section is the first thing
 * the form asks for and the only place an invoice can write back to the
 * customer record.
 */

test.beforeEach(async () => {
  await resetBusinessData();
});

async function savedCustomers() {
  return testDb.query.customers.findMany({
    where: eq(schema.customers.businessId, TEST_BUSINESS_ID),
  });
}

test("C1 an invoice with no customer offers a search", async ({ page }) => {
  await gotoNewInvoice(page);

  const picker = billToSection(page).getByRole("combobox");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveText("Search customers...");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  // Nothing to show until someone is chosen.
  await expect(billToSection(page).locator("dl")).toBeHidden();
});

test("C19 the customer picker tells a screen reader what it picks", async ({ page }) => {
  test.fail();
  await gotoNewInvoice(page);

  // `role="combobox"` is not a name-from-content role, so the trigger's visible
  // "Search customers..." never reaches the accessibility tree and it announces
  // as an unlabelled combobox. It needs an explicit aria-label.
  await expect(billToSection(page).getByRole("combobox", { name: /customer/i })).toBeVisible();
});

test.describe("C2 searching for a saved customer", () => {
  test.beforeEach(async () => {
    await seedCustomer(CUSTOMERS.acme);
    await seedCustomer(CUSTOMERS.beacon);
  });

  const queries = [
    { by: "name", query: "Priya" },
    { by: "company", query: "Acme" },
    { by: "phone", query: "9111" },
    { by: "email", query: "priya@acme" },
  ];

  for (const { by, query } of queries) {
    test(`matches on ${by}`, async ({ page }) => {
      await gotoNewInvoice(page);
      await openCustomerPicker(page);
      await page.getByPlaceholder("Search customers...").fill(query);

      await expect(page.getByRole("option", { name: /Priya Nair/ })).toBeVisible();
      await expect(page.getByRole("option", { name: /Sam Okafor/ })).toBeHidden();
    });
  }

  test("picking one fills the details, read only", async ({ page }) => {
    await gotoNewInvoice(page);
    await pickCustomer(page, /Priya Nair/, "Acme");

    await expect(billToDetail(page, "Name")).toHaveText("Priya Nair");
    await expect(billToDetail(page, "Company")).toHaveText("Acme Constructions");
    await expect(billToDetail(page, "Phone")).toHaveText("02 9111 2222");
    await expect(billToDetail(page, "Email")).toHaveText("priya@acme.example");
    await expect(billToDetail(page, "Billing address")).toHaveText(
      "14 Wharf Road, Level 3, Pyrmont NSW 2009",
    );

    // Read only until Edit is pressed — no inputs in the section.
    await expect(billToSection(page).getByLabel("Name", { exact: true })).toBeHidden();
  });

  test("a search matching nobody still offers to create one", async ({ page }) => {
    await gotoNewInvoice(page);
    await openCustomerPicker(page);
    await page.getByPlaceholder("Search customers...").fill("Nobody here");

    await expect(page.getByText("No customers found.")).toBeVisible();
    await expect(page.getByRole("option", { name: /^New customer/ })).toBeVisible();
  });
});

test("C3 New customer starts from what was typed", async ({ page }) => {
  await gotoNewInvoice(page);
  await openCustomerPicker(page);
  await page.getByPlaceholder("Search customers...").fill("Kelly Brooks");

  await expect(page.getByRole("option", { name: "New customer “Kelly Brooks”" })).toBeVisible();
  await page.getByRole("option", { name: /^New customer/ }).click();

  await expect(billToSection(page).getByLabel("Name", { exact: true })).toHaveValue("Kelly Brooks");
});

test("C4 a customer created here is saved and findable afterwards", async ({ page }) => {
  await gotoNewInvoice(page);
  await startNewCustomer(page, "Kelly Brooks");

  await billToSection(page).getByLabel("Company", { exact: true }).fill("Brooks Joinery");
  await billToSection(page).getByLabel("Email", { exact: true }).fill("kelly@brooks.example");
  await billToSave(page).click();

  await expect(billToDetail(page, "Company")).toHaveText("Brooks Joinery");

  // It is a real customer record, not just this invoice's snapshot.
  expect(await savedCustomers()).toMatchObject([
    { name: "Kelly Brooks", company: "Brooks Joinery", email: "kelly@brooks.example" },
  ]);

  await page.getByRole("link", { name: "All invoices" }).click();
  await gotoNewInvoice(page);
  await openCustomerPicker(page);
  await page.getByPlaceholder("Search customers...").fill("Brooks");
  await expect(page.getByRole("option", { name: /Kelly Brooks/ })).toBeVisible();
});

test("C5 editing writes through to the customer record and the invoice", async ({ page }) => {
  const customer = await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await billToSection(page).getByRole("button", { name: "Edit" }).click();
  await replaceText(billToSection(page).getByLabel("Phone", { exact: true }), "02 9333 4444");
  await billToSave(page).click();

  await expect(billToDetail(page, "Phone")).toHaveText("02 9333 4444");

  const [saved] = await savedCustomers();
  expect(saved).toMatchObject({ id: customer.id, phone: "02 9333 4444" });
});

test("C6 cancelling an edit leaves both the invoice and the record alone", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await billToSection(page).getByRole("button", { name: "Edit" }).click();
  await replaceText(billToSection(page).getByLabel("Phone", { exact: true }), "02 9333 4444");
  await billToSection(page).getByRole("button", { name: "Cancel" }).click();

  await expect(billToDetail(page, "Phone")).toHaveText("02 9111 2222");
  expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
});

test("C7 a customer needs a name or a company", async ({ page }) => {
  await gotoNewInvoice(page);
  await startNewCustomer(page, "Kelly Brooks");

  await replaceText(billToSection(page).getByLabel("Name", { exact: true }), "");
  await billToSave(page).click();

  await expect(page.getByText("Every customer needs a name or company.")).toBeVisible();
  expect(await savedCustomers()).toEqual([]);
});

test("C8 switching customer replaces every bill-to field", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await seedCustomer(CUSTOMERS.beacon);
  await gotoNewInvoice(page);

  await pickCustomer(page, /Priya Nair/);
  await expect(billToDetail(page, "Name")).toHaveText("Priya Nair");

  await pickCustomer(page, /Sam Okafor/);
  await expect(billToDetail(page, "Name")).toHaveText("Sam Okafor");
  await expect(billToDetail(page, "Company")).toHaveText("Beacon Cafe");
  await expect(billToDetail(page, "Phone")).toHaveText("03 8444 5555");
  await expect(billToDetail(page, "Email")).toHaveText("sam@beacon.example");
  await expect(billToDetail(page, "Billing address")).toHaveText(
    "5 Little Bourke Street, Melbourne VIC 3000",
  );
});

test("C9 switching customer resets the delivery checkbox", async ({ page }) => {
  test.fixme();
  await seedCustomer(CUSTOMERS.acme);
  await seedCustomer(CUSTOMERS.beacon);
  await gotoNewInvoice(page);

  await pickCustomer(page, /Priya Nair/);
  await deliveryCheckbox(page).check();

  // Delivery is the order's, not the customer's, so a different customer starts over.
  await pickCustomer(page, /Sam Okafor/);
  await expect(deliveryCheckbox(page)).not.toBeChecked();
});

test("C10 delivery is off until it is asked for", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await expect(deliveryCheckbox(page)).not.toBeChecked();
  await expect(addressInput(page, "Delivery")).toBeHidden();
});

test("C11 a customer with a delivery address gets it by default", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await deliveryCheckbox(page).check();

  await expect(addressInput(page, "Delivery")).toHaveValue("88 Depot Lane, Alexandria NSW 2015");
});

test("C12 a customer without one delivers to the billing address", async ({ page }) => {
  await seedCustomer(CUSTOMERS.beacon);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Sam Okafor/);
  await deliveryCheckbox(page).check();

  await expect(billToSection(page).getByText("Same as billing address")).toBeVisible();
});

test("C13 delivery can be switched between billing and its own address", async ({ page }) => {
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

test("C14 the customer's saved delivery address can be restored once changed", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await deliveryCheckbox(page).check();

  const restore = billToSection(page).getByRole("button", { name: "Use saved address" });
  // Nothing to restore while it still matches the customer's own address.
  await expect(restore).toBeHidden();

  await addressInput(page, "Delivery").click();
  await replaceText(page.getByLabel("Delivery address line 1"), "2 Riverside Drive");
  await page.getByLabel("Delivery suburb").click();
  await expect(restore).toBeVisible();

  await restore.click();
  await expect(addressInput(page, "Delivery")).toHaveValue("88 Depot Lane, Alexandria NSW 2015");
});

test("C15 an empty address is entered by lookup", async ({ page }) => {
  await gotoNewInvoice(page);
  await startNewCustomer(page, "Kelly Brooks");

  await page.getByLabel("Billing address search").fill("Cartwright");
  await page.getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" }).click();

  await expect(addressInput(page, "Billing")).toHaveValue(
    "6097 Cartwright Track, North Eve ACT 0897",
  );
});

test("C16 an address can be typed out instead of looked up", async ({ page }) => {
  await gotoNewInvoice(page);
  await startNewCustomer(page, "Kelly Brooks");

  await page.getByRole("button", { name: "Enter address manually" }).first().click();

  await page.getByLabel("Billing address line 1").fill("9 Bay Street");
  await page.getByLabel("Billing suburb").fill("Ultimo");
  await page.getByLabel("Billing state").fill("NSW");
  await page.getByLabel("Billing postcode").fill("2007");

  await billToSection(page).getByLabel("Company", { exact: true }).click();
  await expect(addressInput(page, "Billing")).toHaveValue("9 Bay Street, Ultimo NSW 2007");
});

test("C17 a filled address shows as one line and opens to its parts", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await billToSection(page).getByRole("button", { name: "Edit" }).click();

  const oneLine = addressInput(page, "Billing");
  await expect(oneLine).toHaveValue("14 Wharf Road, Level 3, Pyrmont NSW 2009");

  await oneLine.click();
  await expect(page.getByLabel("Billing address line 1")).toHaveValue("14 Wharf Road");
  await expect(page.getByLabel("Billing address line 2")).toHaveValue("Level 3");
  await expect(page.getByLabel("Billing suburb")).toHaveValue("Pyrmont");
  await expect(page.getByLabel("Billing state")).toHaveValue("NSW");
  await expect(page.getByLabel("Billing postcode")).toHaveValue("2009");

  // Focus leaving the group collapses it again.
  await billToSection(page).getByLabel("Company", { exact: true }).click();
  await expect(oneLine).toBeVisible();
  await expect(page.getByLabel("Billing address line 1")).toBeHidden();
});

test("C18 the first address line doubles as the lookup while open", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await billToSection(page).getByRole("button", { name: "Edit" }).click();

  await addressInput(page, "Billing").click();
  await page.getByLabel("Billing address line 1").fill("Cartwright");
  await page.getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" }).click();

  await expect(page.getByLabel("Billing suburb")).toHaveValue("North Eve");
  await expect(page.getByLabel("Billing postcode")).toHaveValue("0897");
});
