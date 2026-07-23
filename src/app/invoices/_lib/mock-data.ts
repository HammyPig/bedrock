import { fakerEN_AU as faker } from "@faker-js/faker";

import { addDaysIso, todayIsoDate } from "~/lib/dates";
import { mockSavedItems } from "~/lib/items";
import { emptyAddress } from "./invoice";
import { computeTotals } from "./money";
import {
  type Address,
  type Customer,
  type CustomerTier,
  type Invoice,
  type InvoiceDraft,
  type PaymentTerms,
} from "./types";

export const SUGGESTED_INVOICE_NUMBER = "INV-0042";

// Fixed seed so the generated list is stable across reloads instead of reshuffling every render.
faker.seed(20260722);

const CUSTOMER_COUNT = 12;
const CUSTOMER_TIERS: CustomerTier[] = ["tier_1", "tier_2", "tier_3"];

function fakeAddress(): Address {
  return {
    line1: faker.location.streetAddress(),
    line2: "",
    suburb: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postcode: faker.location.zipCode(),
  };
}

export const mockCustomers: Customer[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  return {
    id: `c-${i + 1}`,
    name: `${firstName} ${lastName}`,
    company: faker.company.name(),
    phone: faker.phone.number(),
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    tier: faker.helpers.arrayElement(CUSTOMER_TIERS),
    billingAddress: fakeAddress(),
    // A minority of customers ship somewhere other than their billing address.
    deliveryAddress: faker.datatype.boolean({ probability: 0.2 }) ? fakeAddress() : emptyAddress(),
  };
});

/** Stand-in for a real address-lookup service (e.g. Google Places, Addressify). */
export const mockAddressSuggestions: Address[] = Array.from({ length: 15 }, () => fakeAddress());

// Own fixed seed, applied immediately before generating: the invoice list stays
// stable across reloads and doesn't depend on which module touched faker first.
faker.seed(20260720);

// One less than the create page's suggested INV-0042, so that reads as the next number.
const INVOICE_COUNT = 41;

const NON_CUSTOM_TERMS: Exclude<PaymentTerms, "custom">[] = [
  "due_on_receipt",
  "net_7",
  "net_14",
  "net_30",
];

export const mockInvoices: Invoice[] = Array.from({ length: INVOICE_COUNT }, (_, i) => {
  // Numbers ascend with time: INV-0001 is the oldest, INV-0041 the most recent.
  const daysAgo = (INVOICE_COUNT - 1 - i) * 3 + faker.number.int({ min: 0, max: 2 });
  const customer = faker.helpers.arrayElement(mockCustomers);
  const { id: customerId, ...billTo } = customer;

  const lineItems = faker.helpers
    .arrayElements(mockSavedItems, { min: 1, max: 5 })
    .map((item, j) => ({
      // Deterministic ids: the module also evaluates in the browser, where random
      // ids would diverge from the server-rendered ones.
      id: `inv-${i + 1}-line-${j + 1}`,
      sku: item.sku,
      name: item.name,
      quantity: faker.number.int({ min: 1, max: 8 }),
      unitPriceCents: item.unitPriceCents,
      discountPercent: faker.helpers.weightedArrayElement([
        { weight: 8, value: 0 },
        { weight: 1, value: 5 },
        { weight: 1, value: 10 },
      ]),
    }));

  const draft: InvoiceDraft = {
    invoiceNumber: `INV-${String(i + 1).padStart(4, "0")}`,
    billTo,
    sourceCustomerId: customerId,
    delivery: faker.datatype.boolean({ probability: 0.15 }),
    deliverySameAsBilling: true,
    poNumber: faker.datatype.boolean({ probability: 0.25 })
      ? `PO-${faker.string.alphanumeric({ length: 6, casing: "upper" })}`
      : "",
    issueDate: addDaysIso(todayIsoDate(), -daysAgo),
    terms: faker.helpers.arrayElement(NON_CUSTOM_TERMS),
    customDueDate: null,
    lineItems,
    discount: faker.datatype.boolean({ probability: 0.15 })
      ? { mode: "percent", value: faker.number.int({ min: 5, max: 15 }) }
      : null,
    freightCents: faker.datatype.boolean({ probability: 0.3 })
      ? faker.number.int({ min: 1000, max: 9500 })
      : 0,
    taxRatePercent: 10,
    paidCents: 0,
    notes: faker.datatype.boolean({ probability: 0.15 }) ? faker.lorem.sentence() : "",
  };

  const { totalCents } = computeTotals(draft);
  const payment = faker.helpers.weightedArrayElement([
    { weight: 5, value: "paid" },
    { weight: 2, value: "partial" },
    { weight: 3, value: "unpaid" },
  ]);
  const paidCents =
    payment === "paid"
      ? totalCents
      : payment === "partial"
        ? Math.round(totalCents * faker.number.float({ min: 0.2, max: 0.8 }))
        : 0;

  return { id: `inv-${i + 1}`, draft: { ...draft, paidCents } };
});
