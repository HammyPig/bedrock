import { addDaysIso } from "~/lib/dates";
import { tierUnitPriceCents, type SavedItem } from "~/lib/items";
import {
  type Address,
  type BillTo,
  type Customer,
  type DraftErrors,
  type InvoiceDraft,
  type LineItem,
  type LineItemBase,
  type PaymentTerms,
} from "./types";

export const DOCUMENT_TYPE_OPTIONS: { isQuote: boolean; label: string }[] = [
  { isQuote: false, label: "Invoice" },
  { isQuote: true, label: "Quote" },
];

export const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_7", label: "Net 7" },
  { value: "net_14", label: "Net 14" },
  { value: "net_30", label: "Net 30" },
  { value: "custom", label: "Custom" },
];

const TERM_DAYS: Record<Exclude<PaymentTerms, "custom">, number> = {
  due_on_receipt: 0,
  net_7: 7,
  net_14: 14,
  net_30: 30,
};

export function deriveDueDate(issueDate: string, terms: Exclude<PaymentTerms, "custom">): string {
  return addDaysIso(issueDate, TERM_DAYS[terms]);
}

/** Effective due date of a draft; custom terms without a date fall back to the issue date. */
export function draftDueDate(draft: Pick<InvoiceDraft, "issueDate" | "terms" | "customDueDate">) {
  return draft.terms === "custom"
    ? (draft.customDueDate ?? draft.issueDate)
    : deriveDueDate(draft.issueDate, draft.terms);
}

export function makeLineItemBase(): LineItemBase {
  return {
    id: crypto.randomUUID(),
    sku: "",
    name: "",
    quantity: 1,
    unitPriceCents: 0,
    discountPercent: 0,
  };
}

export function makeLineItem(): LineItem {
  return { ...makeLineItemBase(), backordered: false };
}

/** Comparison key only — mirrors the server's SKU uniqueness check. */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * Re-prices catalog-backed lines when the invoice's tier changes. A line follows
 * the tier only while its price still matches what the old tier would charge —
 * hand-edited prices and lines that aren't in the catalog stay untouched.
 */
export function repriceLineItems(
  lineItems: LineItem[],
  savedItems: SavedItem[],
  fromTierId: string | null,
  toTierId: string | null,
): LineItem[] {
  return lineItems.map((line) => {
    if (line.sku.trim() === "") return line;
    const saved = savedItems.find((item) => normalizeSku(item.sku) === normalizeSku(line.sku));
    if (!saved || line.unitPriceCents !== tierUnitPriceCents(saved, fromTierId)) return line;
    return { ...line, unitPriceCents: tierUnitPriceCents(saved, toTierId) };
  });
}

export function emptyAddress(): Address {
  return { line1: "", line2: "", suburb: "", state: "", postcode: "" };
}

export function addressHasContent(address: Address): boolean {
  const values = [address.line1, address.line2, address.suburb, address.state, address.postcode];
  return values.some((value) => value.trim() !== "");
}

export function addressesEqual(a: Address, b: Address): boolean {
  return (
    a.line1 === b.line1 &&
    a.line2 === b.line2 &&
    a.suburb === b.suburb &&
    a.state === b.state &&
    a.postcode === b.postcode
  );
}

/** "Line1, Line2, Suburb STATE Postcode", skipping empty parts. */
export function formatAddressOneLine(address: Address): string {
  const locality = [address.suburb, address.state, address.postcode]
    .filter((part) => part.trim() !== "")
    .join(" ");
  return [address.line1, address.line2, locality].filter((part) => part.trim() !== "").join(", ");
}

export function emptyBillTo(): BillTo {
  return {
    name: "",
    company: "",
    phone: "",
    email: "",
    tierId: null,
    billingAddress: emptyAddress(),
    deliveryAddress: emptyAddress(),
  };
}

export function billToMatchesCustomer(billTo: BillTo, customer: Customer): boolean {
  return (
    billTo.name === customer.name &&
    billTo.company === customer.company &&
    billTo.phone === customer.phone &&
    billTo.email === customer.email &&
    billTo.tierId === customer.tierId &&
    addressesEqual(billTo.billingAddress, customer.billingAddress) &&
    addressesEqual(billTo.deliveryAddress, customer.deliveryAddress)
  );
}

export function billToHasContent(billTo: BillTo): boolean {
  return (
    [billTo.name, billTo.company, billTo.phone, billTo.email].some(
      (value) => value.trim() !== "",
    ) ||
    billTo.tierId !== null ||
    addressHasContent(billTo.billingAddress) ||
    addressHasContent(billTo.deliveryAddress)
  );
}

/**
 * The fields that can identify a customer, in the order they stand in for each
 * other. This is exactly the set the customer picker searches, which is the
 * point: a customer exists if you could find them again. An address cannot.
 */
export const IDENTITY_FIELDS = ["name", "company", "phone", "email"] as const;

type Identity = Pick<Customer, (typeof IDENTITY_FIELDS)[number]>;

export function billToHasIdentity(billTo: Identity): boolean {
  return IDENTITY_FIELDS.some((field) => billTo[field].trim() !== "");
}

/** Display label for a customer or bill-to snapshot: whichever identity they have. */
export function customerDisplayName(customer: Identity): string {
  const field = IDENTITY_FIELDS.find((name) => customer[name].trim() !== "");
  return field === undefined ? "Unnamed customer" : customer[field].trim();
}

export function validateDraft(draft: InvoiceDraft): DraftErrors | null {
  const invalidLineItemIds = draft.lineItems
    .filter((item) => item.name.trim() === "" || item.quantity <= 0)
    .map((item) => item.id);

  const errors: DraftErrors = { invalidLineItemIds };
  if (draft.invoiceNumber.trim() === "") {
    errors.invoiceNumber = draft.isQuote
      ? "Quote number is required."
      : "Invoice number is required.";
  }
  if (!billToHasIdentity(draft.billTo)) {
    errors.billTo = "Select a customer to bill.";
  }
  if (invalidLineItemIds.length > 0) {
    errors.lineItems = "Each line item needs a name and a quantity above zero.";
  }

  return errors.invoiceNumber || errors.billTo || errors.lineItems ? errors : null;
}
