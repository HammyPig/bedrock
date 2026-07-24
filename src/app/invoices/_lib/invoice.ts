import { addDaysIso } from "~/lib/dates";
import {
  type Address,
  type BillTo,
  type Customer,
  type CustomerTier,
  type DraftErrors,
  type InvoiceDraft,
  type LineItem,
  type PaymentTerms,
} from "./types";

export const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_7", label: "Net 7" },
  { value: "net_14", label: "Net 14" },
  { value: "net_30", label: "Net 30" },
  { value: "custom", label: "Custom" },
];

export const CUSTOMER_TIER_OPTIONS: { value: CustomerTier; label: string }[] = [
  { value: "tier_1", label: "Tier 1" },
  { value: "tier_2", label: "Tier 2" },
  { value: "tier_3", label: "Tier 3" },
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

export function makeLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    sku: "",
    name: "",
    quantity: 1,
    unitPriceCents: 0,
    discountPercent: 0,
  };
}

export function emptyAddress(): Address {
  return { line1: "", line2: "", suburb: "", state: "", postcode: "" };
}

export function addressHasContent(address: Address): boolean {
  const values = [address.line1, address.line2, address.suburb, address.state, address.postcode];
  return values.some((value) => value.trim() !== "");
}

function addressesEqual(a: Address, b: Address): boolean {
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
    tier: "",
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
    billTo.tier === customer.tier &&
    addressesEqual(billTo.billingAddress, customer.billingAddress) &&
    addressesEqual(billTo.deliveryAddress, customer.deliveryAddress)
  );
}

export function billToHasContent(billTo: BillTo): boolean {
  return (
    [billTo.name, billTo.company, billTo.phone, billTo.email, billTo.tier].some(
      (value) => value.trim() !== "",
    ) ||
    addressHasContent(billTo.billingAddress) ||
    addressHasContent(billTo.deliveryAddress)
  );
}

/** Display label for a customer or bill-to snapshot: contact name, falling back to company. */
export function customerDisplayName(customer: Pick<Customer, "name" | "company">): string {
  if (customer.name.trim() !== "") return customer.name;
  if (customer.company.trim() !== "") return customer.company;
  return "Unnamed customer";
}

export function validateDraft(draft: InvoiceDraft): DraftErrors | null {
  const invalidLineItemIds = draft.lineItems
    .filter((item) => item.name.trim() === "" || item.quantity <= 0)
    .map((item) => item.id);

  const errors: DraftErrors = { invalidLineItemIds };
  if (draft.invoiceNumber.trim() === "") {
    errors.invoiceNumber = "Invoice number is required.";
  }
  if (draft.billTo.name.trim() === "" && draft.billTo.company.trim() === "") {
    errors.billTo = "Billing details need at least a name or company.";
  }
  if (invalidLineItemIds.length > 0) {
    errors.lineItems = "Each line item needs a name and a quantity above zero.";
  }

  return errors.invoiceNumber || errors.billTo || errors.lineItems ? errors : null;
}
