import * as schema from "~/server/db/schema";
import { type Address, type InvoiceDraft } from "~/app/invoices/_lib/types";
import { TEST_BUSINESS_ID, testDb } from "./db";

/**
 * Seed data for the browser tests. Rows go in through the database rather than
 * the UI so an invoice test never fails because the customer page is broken;
 * the tests that are *about* creating a customer create one through the UI.
 */

export const EMPTY_ADDRESS: Address = {
  line1: "",
  line2: "",
  suburb: "",
  state: "",
  postcode: "",
};

type CustomerSeed = Omit<typeof schema.customers.$inferInsert, "businessId">;

export const CUSTOMERS = {
  /** Billing and delivery differ, so "use the saved delivery address" has something to use. */
  acme: {
    name: "Priya Nair",
    company: "Acme Constructions",
    phone: "02 9111 2222",
    email: "priya@acme.example",
    billingAddress: {
      line1: "14 Wharf Road",
      line2: "Level 3",
      suburb: "Pyrmont",
      state: "NSW",
      postcode: "2009",
    },
    deliveryAddress: {
      line1: "88 Depot Lane",
      line2: "",
      suburb: "Alexandria",
      state: "NSW",
      postcode: "2015",
    },
  },
  /** No delivery address, so picking them defaults delivery to "same as billing". */
  beacon: {
    name: "Sam Okafor",
    company: "Beacon Cafe",
    phone: "03 8444 5555",
    email: "sam@beacon.example",
    billingAddress: {
      line1: "5 Little Bourke Street",
      line2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
    },
    deliveryAddress: EMPTY_ADDRESS,
  },
  /** No email at all — the "add an email address first" path (E2). */
  walkUp: {
    name: "Jo Mitchell",
    company: "",
    phone: "0400 000 111",
    email: "",
    billingAddress: EMPTY_ADDRESS,
    deliveryAddress: EMPTY_ADDRESS,
  },
} satisfies Record<string, CustomerSeed>;

type ItemSeed = Omit<typeof schema.items.$inferInsert, "businessId">;

export const ITEMS = {
  /** One SKU is a prefix of the other, so a lookup test can prove it isn't sloppy. */
  pipe100: { sku: "PIPE-100", name: "Copper pipe 100mm", unitPriceCents: 4250, barcode: "9310001" },
  pipe1000: {
    sku: "PIPE-1000",
    name: "Copper pipe 1000mm",
    unitPriceCents: 18_900,
    barcode: "9310002",
  },
  labour: { sku: "LAB-HR", name: "Labour (per hour)", unitPriceCents: 12_000, barcode: "" },
} satisfies Record<string, ItemSeed>;

export async function seedCustomer(seed: CustomerSeed) {
  const [row] = await testDb
    .insert(schema.customers)
    .values({ businessId: TEST_BUSINESS_ID, ...seed })
    .returning();
  if (!row) throw new Error(`Failed to seed customer ${seed.name}`);
  return row;
}

export async function seedItem(seed: ItemSeed) {
  const [row] = await testDb
    .insert(schema.items)
    .values({ businessId: TEST_BUSINESS_ID, ...seed })
    .returning();
  if (!row) throw new Error(`Failed to seed item ${seed.sku}`);
  return row;
}

/** The three catalog items above, for tests that just need a catalog to search. */
export function seedCatalog() {
  return Promise.all(Object.values(ITEMS).map(seedItem));
}

/**
 * A saved invoice, written straight to the database. Line items carry their
 * `position` so a reordering test can read the order back without the UI.
 */
export async function seedInvoice(
  draft: InvoiceDraft,
  payments: { amountCents: number; paidDate: string }[] = [],
) {
  const { lineItems, ...rest } = draft;

  const [invoice] = await testDb
    .insert(schema.invoices)
    .values({ businessId: TEST_BUSINESS_ID, ...rest })
    .returning();
  if (!invoice) throw new Error(`Failed to seed invoice ${draft.invoiceNumber}`);

  if (lineItems.length > 0) {
    await testDb.insert(schema.invoiceLineItems).values(
      lineItems.map((item, position) => ({
        invoiceId: invoice.id,
        position,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountPercent: item.discountPercent,
        backordered: item.backordered,
      })),
    );
  }

  if (payments.length > 0) {
    await testDb
      .insert(schema.payments)
      .values(payments.map((payment) => ({ invoiceId: invoice.id, ...payment })));
  }

  return invoice;
}
