import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";
import { resetBusinessData, TEST_BUSINESS_ID, testDb } from "../support/db";
import { billTo, draft, line } from "../support/drafts";
import { CUSTOMERS, seedCustomer, seedInvoice } from "../support/fixtures";
import {
  addressInput,
  billToField,
  billToFlash,
  billToSection,
  deliveryCheckbox,
  editedMenu,
  fillMinimalInvoice,
  gotoNewInvoice,
  openCustomerPicker,
  pickCustomer,
  replaceText,
  saveInvoice,
  startNewCustomer,
  trpcRequest,
  updateCustomerPrompt,
} from "../support/invoice-page";

/**
 * C1-C25. Every invoice bills a *saved* customer, so the section opens as a
 * search: the only two moves are finding someone or deliberately creating them.
 *
 * The rule that holds the rest together is that a customer exists if you could
 * find them again — one of name, company, phone or email, which is exactly the
 * set the picker searches. Nothing else counts as identity.
 *
 * Creating and editing are then deliberately asymmetric, because they answer
 * different questions. A new customer has no record to contradict, so it saves
 * itself as you type. An existing one does, and the invoice keeps its own
 * snapshot of them (P4), so changing their details asks before writing back.
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

  // Nothing to fill in until someone is chosen — no half-filled form to abandon.
  await expect(billToField(page, "Name")).toBeHidden();
  await expect(deliveryCheckbox(page)).toBeHidden();
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

  test("picking one fills the fields, ready to edit", async ({ page }) => {
    await gotoNewInvoice(page);
    await pickCustomer(page, /Priya Nair/, "Acme");

    await expect(billToField(page, "Name")).toHaveValue("Priya Nair");
    await expect(billToField(page, "Company")).toHaveValue("Acme Constructions");
    await expect(billToField(page, "Phone")).toHaveValue("02 9111 2222");
    await expect(billToField(page, "Email")).toHaveValue("priya@acme.example");
    await expect(addressInput(page, "Billing")).toHaveValue(
      "14 Wharf Road, Level 3, Pyrmont NSW 2009",
    );

    // No mode to unlock first, and nothing has diverged yet.
    await expect(billToField(page, "Name")).toBeEditable();
    await expect(editedMenu(page)).toBeHidden();
  });

  test("a search matching nobody still offers to create one", async ({ page }) => {
    await gotoNewInvoice(page);
    await openCustomerPicker(page);
    await page.getByPlaceholder("Search customers...").fill("Nobody here");

    await expect(page.getByText("No customers found.")).toBeVisible();
    await expect(page.getByRole("option", { name: /^New customer/ })).toBeVisible();
  });
});

test("C3 switching customer replaces every bill-to field", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await seedCustomer(CUSTOMERS.beacon);
  await gotoNewInvoice(page);

  await pickCustomer(page, /Priya Nair/);
  await expect(billToField(page, "Name")).toHaveValue("Priya Nair");

  await pickCustomer(page, /Sam Okafor/);
  await expect(billToField(page, "Name")).toHaveValue("Sam Okafor");
  await expect(billToField(page, "Company")).toHaveValue("Beacon Cafe");
  await expect(billToField(page, "Phone")).toHaveValue("03 8444 5555");
  await expect(billToField(page, "Email")).toHaveValue("sam@beacon.example");
  await expect(addressInput(page, "Billing")).toHaveValue(
    "5 Little Bourke Street, Melbourne VIC 3000",
  );
});

/**
 * You have already typed the information once. Which box it belongs in is
 * something the form can work out, and getting it wrong costs nothing because
 * the fields are open right there to correct.
 */
test.describe("C4 New customer starts from what was typed", () => {
  const typed = [
    { what: "letters are a name", query: "Kelly Brooks", field: "Name" },
    { what: "digits are a phone number", query: "0412 345 678", field: "Phone" },
    { what: "an @ is an email address", query: "kelly@brooks.example", field: "Email" },
    // Anything that could be either falls through to the name. A wrong guess is
    // visible and one click from fixed; a clever guess that is wrong is not.
    { what: "letters and digits together are a name", query: "Dave 0412", field: "Name" },
  ];

  for (const { what, query, field } of typed) {
    test(what, async ({ page }) => {
      await gotoNewInvoice(page);
      await openCustomerPicker(page);
      await page.getByPlaceholder("Search customers...").fill(query);
      await expect(page.getByRole("option", { name: `New customer “${query}”` })).toBeVisible();
      await page.getByRole("option", { name: /^New customer/ }).click();

      await expect(billToField(page, field)).toHaveValue(query);
      // Landed mid-entry: the caret is already in the field it guessed, so a
      // wrong guess is corrected without reaching for the mouse.
      await expect(billToField(page, field)).toBeFocused();
      for (const other of ["Name", "Company", "Phone", "Email"].filter((f) => f !== field)) {
        await expect(billToField(page, other)).toHaveValue("");
      }

      // The switcher says what it is pointing at, and this is not a saved one yet.
      await expect(billToSection(page).getByRole("combobox")).toHaveText("New customer");
    });
  }

  test("it stays reachable however many customers there are", async ({ page }) => {
    // Enough to overflow the list. Only the customers scroll, so the option is
    // still on screen rather than needing a search to bring it back into reach.
    for (let i = 0; i < 15; i++) {
      await seedCustomer({ ...CUSTOMERS.acme, name: `Customer ${i}`, email: "", phone: "" });
    }
    await gotoNewInvoice(page);
    await openCustomerPicker(page);

    await expect(page.getByRole("option", { name: /^New customer/ })).toBeInViewport();
  });

  test("creating one from an empty search opens empty fields", async ({ page }) => {
    await gotoNewInvoice(page);
    await openCustomerPicker(page);
    await expect(page.getByRole("option", { name: "New customer", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "New customer", exact: true }).click();

    await expect(billToField(page, "Name")).toBeVisible();
    await expect(billToField(page, "Name")).toHaveValue("");
    await expect(billToField(page, "Name")).toBeFocused();
  });
});

test("C5 a new customer saves itself once it has something to go by", async ({ page }) => {
  await gotoNewInvoice(page);

  // Leaving the field the search text landed in is what commits it.
  const created = trpcRequest(page, "customer.create");
  await startNewCustomer(page, "Kelly Brooks");
  await billToField(page, "Company").click();
  await created;

  await expect(billToFlash(page)).toHaveText("Saved");
  // Saved, so the switcher stops calling them new and starts naming them.
  await expect(billToSection(page).getByRole("combobox")).toHaveText("Kelly Brooks");

  // Still being created, so filling in the rest keeps saving rather than
  // treating each field as an edit to confirm.
  const updated = trpcRequest(page, "customer.update");
  await billToField(page, "Company").fill("Brooks Joinery");
  await billToField(page, "Email").click();
  await updated;
  await expect(editedMenu(page)).toBeHidden();

  // A real customer record, not just this invoice's snapshot — read back through
  // the picker, which lists what the server has rather than what the form holds.
  // The flash is what says the write came back: navigating while it is still in
  // flight aborts it, and the record would never gain the company at all.
  await expect(billToFlash(page)).toHaveText("Updated");
  await page.getByRole("link", { name: "All invoices" }).click();
  await gotoNewInvoice(page);
  await openCustomerPicker(page);
  await page.getByPlaceholder("Search customers...").fill("Brooks");
  await expect(page.getByRole("option", { name: /Brooks Joinery/ })).toBeVisible();
});

/**
 * The search text is the decision to create someone; the focus that follows is
 * the chance to refine it, not a condition of keeping it. Typing something and
 * then losing it because the next click went somewhere unexpected is the one
 * outcome this section must not have.
 */
test.describe("C6 what was typed becomes the customer", () => {
  test("it is kept even on the way to picking somebody else", async ({ page }) => {
    await seedCustomer(CUSTOMERS.acme);
    await gotoNewInvoice(page);

    const created = trpcRequest(page, "customer.create");
    await startNewCustomer(page, "Priya");
    await pickCustomer(page, /Priya Nair/);
    await created;

    // The invoice bills the one that was picked, and a create landing after the
    // pick does not get to quietly relink it to what it just made.
    await expect(billToField(page, "Name")).toHaveValue("Priya Nair");
    await expect(billToSection(page).getByRole("combobox")).toHaveText("Priya Nair");
    await expect(editedMenu(page)).toBeHidden();

    // Two records, deliberately: what was typed is still there rather than
    // silently dropped. Tidying the pair up is a merge, its own piece of work.
    await openCustomerPicker(page);
    await expect(page.getByRole("option", { name: "Priya", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: /Priya Nair/ })).toBeVisible();
  });

  test("it can be finished off first, and that is what is saved", async ({ page }) => {
    await gotoNewInvoice(page);

    const created = trpcRequest(page, "customer.create");
    await startNewCustomer(page, "Kelly");
    // The caret is already in Name, so a half-typed search is completed in
    // place rather than retyped.
    await page.keyboard.press("End");
    await page.keyboard.type(" Brooks");
    await billToField(page, "Company").click();
    await created;

    await openCustomerPicker(page);
    await expect(page.getByRole("option", { name: "Kelly Brooks", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Kelly", exact: true })).toBeHidden();
  });
});

test("C7 a customer needs a name, company, phone or email", async ({ page }) => {
  await gotoNewInvoice(page);
  // Nothing was typed, so Name opens focused but empty.
  await startNewCustomer(page);

  await billToField(page, "Company").click();
  expect(await savedCustomers()).toEqual([]);

  // An address is not an identity: there is still nobody to bill.
  await page.getByLabel("Line 1 name").fill("Callout fee");
  await saveInvoice(page).click();
  await expect(page.getByText("Select a customer to bill.")).toBeVisible();
  expect(await savedCustomers()).toEqual([]);
});

test("C8 a customer with only a phone is shown and found by it", async ({ page }) => {
  await seedCustomer(CUSTOMERS.cashJob);
  await gotoNewInvoice(page);

  // Name, then company, then phone, then email: whichever they actually have.
  await pickCustomer(page, /0433 777 888/, "0433");

  await expect(billToField(page, "Phone")).toHaveValue("0433 777 888");
  await expect(billToSection(page).getByRole("combobox")).toHaveText(/0433 777 888/);
});

test("C9 editing a chosen customer changes the invoice, not their record", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await replaceText(billToField(page, "Phone"), "02 9333 4444");
  await billToField(page, "Email").click();

  await expect(editedMenu(page)).toBeVisible();
  expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
});

test("C10 the edit can be written back to the customer straight away", async ({ page }) => {
  const customer = await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await replaceText(billToField(page, "Phone"), "02 9333 4444");

  await editedMenu(page).click();
  // Two ways out, and neither of them makes a second customer: saving a copy is
  // how duplicate records get made, and merging them back is the expensive part.
  await expect(page.getByRole("menuitem", { name: "Update saved customer" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reset to saved" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Save as new/ })).toBeHidden();

  await page.getByRole("menuitem", { name: "Update saved customer" }).click();

  await expect(billToFlash(page)).toHaveText("Updated");
  await expect(editedMenu(page)).toBeHidden();
  expect(await savedCustomers()).toMatchObject([{ id: customer.id, phone: "02 9333 4444" }]);
});

test("C11 the edit can be thrown away instead", async ({ page }) => {
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

/**
 * The edit menu is easy to walk past while looking at line items, and a change
 * that only ever reached this invoice is one the customer's record silently
 * lost. Saving is the moment they are demonstrably finished, so it is the last
 * honest place to ask.
 */
test("C12 saving the invoice offers to update the customer too", async ({ page }) => {
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

test("C13 the edit can stay on this invoice alone", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await fillMinimalInvoice(page, /Priya Nair/);
  await replaceText(billToField(page, "Phone"), "02 9333 4444");

  await saveInvoice(page).click();
  await updateCustomerPrompt(page).getByRole("button", { name: "Just this invoice" }).click();
  await page.waitForURL(/\/invoices\/[^/]+\/edit$/);

  expect(await savedCustomers()).toMatchObject([{ phone: "02 9111 2222" }]);
  await expect(billToField(page, "Phone")).toHaveValue("02 9333 4444");

  // Answered once. Asking again on every save is how people learn to dismiss it.
  await saveInvoice(page).click();
  await expect(updateCustomerPrompt(page)).toBeHidden();
});

test("C14 an invoice whose customer is gone has nothing to diverge from", async ({ page }) => {
  const customer = await seedCustomer(CUSTOMERS.acme);
  const invoice = await seedInvoice(
    draft({
      invoiceNumber: "INV-0910",
      sourceCustomerId: customer.id,
      billTo: billTo({ name: "Priya Nair", company: "Acme Constructions", phone: "02 9111 2222" }),
      lineItems: [line()],
    }),
  );
  await testDb.delete(schema.customers).where(eq(schema.customers.id, customer.id));

  await page.goto(`/invoices/${invoice.id}/edit`);
  await expect(billToField(page, "Name")).toHaveValue("Priya Nair");

  await replaceText(billToField(page, "Phone"), "02 9333 4444");
  await billToField(page, "Email").click();

  // The snapshot is all there is now, so nothing offers to write anywhere.
  await expect(editedMenu(page)).toBeHidden();
  expect(await savedCustomers()).toEqual([]);
});

test("C15 switching customer resets the delivery checkbox", async ({ page }) => {
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

test("C16 delivery is off until it is asked for", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await expect(deliveryCheckbox(page)).not.toBeChecked();
  await expect(addressInput(page, "Delivery")).toBeHidden();
});

test("C17 a customer with a delivery address gets it by default", async ({ page }) => {
  test.fixme();
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);
  await deliveryCheckbox(page).check();

  await expect(addressInput(page, "Delivery")).toHaveValue("88 Depot Lane, Alexandria NSW 2015");
});

test("C18 a customer without one delivers to the billing address", async ({ page }) => {
  await seedCustomer(CUSTOMERS.beacon);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Sam Okafor/);
  await deliveryCheckbox(page).check();

  await expect(billToSection(page).getByText("Same as billing address")).toBeVisible();
});

test("C19 delivery can be switched between billing and its own address", async ({ page }) => {
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

test("C20 the customer's saved delivery address can be restored once changed", async ({ page }) => {
  test.fixme();
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

test("C21 an empty address is entered by lookup", async ({ page }) => {
  await gotoNewInvoice(page);
  await startNewCustomer(page, "Kelly Brooks");

  await page.getByLabel("Billing address search").fill("Cartwright");
  await page.getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" }).click();

  await expect(addressInput(page, "Billing")).toHaveValue(
    "6097 Cartwright Track, North Eve ACT 0897",
  );
});

test("C22 an address can be typed out instead of looked up", async ({ page }) => {
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

test("C23 a filled address shows as one line and opens to its parts", async ({ page }) => {
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

  // Focus leaving the group collapses it again.
  await billToField(page, "Company").click();
  await expect(oneLine).toBeVisible();
  await expect(page.getByLabel("Billing address line 1")).toBeHidden();
});

test("C24 the first address line doubles as the lookup while open", async ({ page }) => {
  await seedCustomer(CUSTOMERS.acme);
  await gotoNewInvoice(page);
  await pickCustomer(page, /Priya Nair/);

  await addressInput(page, "Billing").click();
  await page.getByLabel("Billing address line 1").fill("Cartwright");
  await page.getByRole("button", { name: "6097 Cartwright Track, North Eve ACT 0897" }).click();

  await expect(page.getByLabel("Billing suburb")).toHaveValue("North Eve");
  await expect(page.getByLabel("Billing postcode")).toHaveValue("0897");
});

test("C25 the customer picker tells a screen reader what it picks", async ({ page }) => {
  test.fail();
  await gotoNewInvoice(page);

  // `role="combobox"` is not a name-from-content role, so the trigger's visible
  // "Search customers..." never reaches the accessibility tree and it announces
  // as an unlabelled combobox. It needs an explicit aria-label, and so does the
  // compact switcher that replaces it once a customer is chosen.
  await expect(billToSection(page).getByRole("combobox", { name: /customer/i })).toBeVisible();
});
