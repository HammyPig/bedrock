import { emptyAddress, makeLineItem } from "~/app/invoices/_lib/invoice";
import { type CustomerDetails, type InvoiceDraft, type LineItem } from "~/app/invoices/_lib/types";

/**
 * Draft builders for the unit specs. Deliberately separate from `db.ts`, which
 * opens a Postgres connection at import time — the unit project must stay free
 * of both a browser and a database.
 */

export function customerDetails(overrides: Partial<CustomerDetails> = {}): CustomerDetails {
  return {
    name: "Dana Reyes",
    company: "Reyes Building",
    phone: "",
    email: "",
    tierId: null,
    billingAddress: emptyAddress(),
    deliveryAddress: emptyAddress(),
    ...overrides,
  };
}

/** A billable line: $100.00 x 1, no discount. */
export function line(overrides: Partial<LineItem> = {}): LineItem {
  return {
    ...makeLineItem(),
    name: "Labour",
    quantity: 1,
    unitPriceCents: 10_000,
    ...overrides,
  };
}

/** A draft that passes validation, so a test only has to state what it changes. */
export function draft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    isQuote: false,
    invoiceNumber: "INV-1001",
    customerDetails: customerDetails(),
    customerId: null,
    hasDeliveryAddress: false,
    deliverySameAsBilling: true,
    issueDate: "2026-08-26",
    terms: "net_30",
    customDueDate: null,
    lineItems: [line()],
    discount: null,
    freightCents: 0,
    taxRatePercent: 10,
    notes: "",
    ...overrides,
  };
}
