import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Locators shared by the invoice specs. Everything is anchored on a role or an
 * accessible name rather than a class, so the tests double as a check that the
 * form is reachable without a mouse.
 */

export async function gotoNewInvoice(page: Page) {
  await page.goto("/invoices/new");
  await page.getByRole("heading", { name: "New invoice" }).waitFor();
}

/** The bill-to section, anchored on its own label. */
export function billToSection(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByText("Bill to", { exact: true }) });
}

/** The read-only value shown against a labelled bill-to detail. */
export function billToDetail(page: Page, label: string): Locator {
  return billToSection(page)
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");
}

/**
 * Opens whichever customer picker the section is showing — the full-width
 * search of the empty state, or the compact switcher once one is chosen. The
 * popover portals out of the section, so this stays unambiguous while open.
 */
export async function openCustomerPicker(page: Page) {
  await billToSection(page).getByRole("combobox").click();
}

export async function pickCustomer(page: Page, name: string | RegExp, query?: string) {
  await openCustomerPicker(page);
  if (query !== undefined) await page.getByPlaceholder("Search customers...").fill(query);
  await page.getByRole("option", { name }).click();
}

/** Chooses "New customer" from the picker, optionally after typing a name. */
export async function startNewCustomer(page: Page, query?: string) {
  await openCustomerPicker(page);
  if (query !== undefined) await page.getByPlaceholder("Search customers...").fill(query);
  await page.getByRole("option", { name: /^New customer/ }).click();
}

/** Save inside the bill-to editor — not the invoice's own Save in the action bar. */
export function billToSave(page: Page): Locator {
  return billToSection(page).getByRole("button", { name: /^Sav(e|ing)/ });
}

export function deliveryCheckbox(page: Page): Locator {
  return page.getByRole("checkbox", { name: "Delivery address" });
}

/**
 * The collapsed one-line address input. Addressed by role because the delivery
 * checkbox shares its label text — `getByLabel` matches both.
 */
export function addressInput(page: Page, prefix: "Billing" | "Delivery"): Locator {
  return page.getByRole("textbox", { name: `${prefix} address`, exact: true });
}

/**
 * Replaces the contents of a field that already holds something.
 *
 * A controlled field can re-render between the select and the insert that make
 * up a fill, which lands the new text beside the old rather than over it
 * ("ReplacedOriginal"). Retrying the fill and its check together rides that out.
 */
export async function replaceText(locator: Locator, value: string) {
  await expect(async () => {
    await locator.fill(value);
    await expect(locator).toHaveValue(value);
  }).toPass({ timeout: 10_000 });
}

/**
 * The numeric cells (quantity, unit price, discount, money fields) swap to raw
 * text on focus and commit on blur. Focusing first lets that swap settle, so the
 * fill isn't overwritten by the re-render it triggers; the blur then commits.
 */
export async function fillAndCommit(locator: Locator, value: string) {
  await locator.click();
  await locator.fill(value);
  await locator.blur();
}

export function documentType(page: Page): Locator {
  return page.getByRole("group", { name: "Document type" });
}

/**
 * The derived due date, which is plain text unless the terms are custom. Its
 * label points at an id that only exists in the custom case, so `getByLabel`
 * finds nothing here.
 */
export function dueDateText(page: Page): Locator {
  return page.getByText("Due date", { exact: true }).locator("xpath=following-sibling::p");
}

export async function setTerms(page: Page, label: string) {
  await page.getByLabel("Terms").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/**
 * One line of the items grid. Anchored on the remove button because it is a
 * direct child of the row, so the innermost enclosing div is the row itself.
 */
export function lineRow(page: Page, index: number): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: `Remove line ${index}` }) })
    .last();
}

/**
 * A line's subtotal: the one cell in the row that isn't an editable field.
 */
export function lineSubtotal(page: Page, index: number): Locator {
  return lineRow(page, index)
    .locator("> div")
    .filter({ hasNot: page.locator("input, textarea") });
}

/**
 * The item names in the order they appear. The per-row labels are positional
 * (`Line 1 name`), so this is how a reordering test reads the order back.
 */
export async function lineNames(page: Page): Promise<string[]> {
  const cells = page.getByRole("textbox", { name: /^Line \d+ name$/ });
  // `all()` takes a snapshot without auto-waiting, so after a navigation it can
  // read an empty grid. Wait for the first row before counting them.
  await cells.first().waitFor();
  return Promise.all((await cells.all()).map((cell) => cell.inputValue()));
}

/**
 * The sticky bar at the foot of the form. The save controls sit in a nested
 * group of their own, so the bar is identified as the innermost element holding
 * both those controls and the status line beside them.
 */
export function actionBar(page: Page): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: "Save + export" }) })
    .filter({ has: page.locator("p") })
    .last();
}

export function saveInvoice(page: Page): Locator {
  return actionBar(page).getByRole("button", { name: "Save", exact: true });
}

/**
 * Saves a brand new invoice and waits for it to land on its own edit page.
 * Without the wait, the next navigation can race the redirect and reload
 * /invoices/new instead.
 */
export async function saveNewInvoice(page: Page) {
  await saveInvoice(page).click();
  await page.waitForURL(/\/invoices\/[^/]+\/edit$/);
}

/** "Draft", "Saving…", "Saved", or an error, shown at the left of the action bar. */
export function saveStatus(page: Page): Locator {
  return actionBar(page).locator("p");
}

/** Picks a customer and fills one line, the least an invoice needs to save. */
export async function fillMinimalInvoice(page: Page, customerName: string | RegExp) {
  await pickCustomer(page, customerName);
  await page.getByLabel("Line 1 name").fill("Callout fee");
  await fillAndCommit(page.getByLabel("Line 1 unit price"), "150.00");
}

/** The totals block, identified by the two lines that bracket it. */
export function totalsPanel(page: Page): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByText("Subtotal", { exact: true }) })
    .filter({ has: page.getByText("Balance due", { exact: true }) })
    .last();
}

/**
 * The amount against a totals line. Each row owns its amount as a direct child
 * span; the label may be a sibling of it (Subtotal, Total) or tucked into a
 * group of controls beside it (Discount, GST).
 */
export function totalsAmount(page: Page, label: string): Locator {
  return totalsPanel(page)
    .locator("> div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("> span")
    .last();
}

/** Balance due, which sits in a block of its own below the payments. */
export function balanceDue(page: Page): Locator {
  return totalsPanel(page)
    .locator("div")
    .filter({ has: page.getByText("Balance due", { exact: true }) })
    .last()
    .locator("span")
    .last();
}
