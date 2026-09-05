import { type SavedItem } from "~/lib/items";

export type PaymentTerms = "due_on_receipt" | "net_7" | "net_14" | "net_30" | "custom";

/** A pricing tier as the UI needs it (Tiered pricing module). */
export interface Tier {
  id: string;
  name: string;
}

export type DiscountMode = "percent" | "fixed";

export interface Discount {
  mode: DiscountMode;
  /** Percent (0-100) when mode is "percent", cents when mode is "fixed". */
  value: number;
}

/** Line-item fields shared with purchase orders. */
export interface LineItemBase {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  /** Per-line discount, 0-100. */
  discountPercent: number;
}

export interface LineItem extends LineItemBase {
  /** On backorder — still billed on this invoice, ships separately. */
  backordered: boolean;
}

export interface Address {
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  /** Pricing tier id (Tiered pricing module); null means unassigned. */
  tierId: string | null;
  billingAddress: Address;
  deliveryAddress: Address;
}

/** The invoice's own billing-details snapshot — editing it never touches the saved customer. */
export type CustomerDetails = Omit<Customer, "id">;

export interface InvoiceDraft {
  /** A quote rather than an invoice: not payable, and switchable to an invoice (and back). */
  isQuote: boolean;
  invoiceNumber: string;
  customerDetails: CustomerDetails;
  /** Saved customer these details were filled from; null for walk-up/manual entry. */
  customerId: string | null;
  /** Per-invoice fulfillment flags — not part of the customer snapshot. */
  delivery: boolean;
  deliverySameAsBilling: boolean;
  poNumber: string;
  /** ISO date, YYYY-MM-DD. */
  issueDate: string;
  terms: PaymentTerms;
  /** Only used when terms is "custom". */
  customDueDate: string | null;
  lineItems: LineItem[];
  discount: Discount | null;
  freightCents: number;
  taxRatePercent: number;
  notes: string;
}

/** A payment received against an invoice; the invoice's paid total is the sum of these. */
export interface Payment {
  id: string;
  amountCents: number;
  /** ISO date, YYYY-MM-DD. */
  paidDate: string;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  balanceCents: number;
}

export interface DraftErrors {
  invoiceNumber?: string;
  customerDetails?: string;
  lineItems?: string;
  invalidLineItemIds: string[];
}

export type InvoiceAction =
  | { type: "patch"; patch: Partial<InvoiceDraft> }
  | { type: "patchCustomerDetails"; patch: Partial<CustomerDetails> }
  | { type: "fillDetailsFromCustomer"; customer: Customer }
  /** "New customer" chosen in the picker, seeded with whatever was searched for. */
  | { type: "startNewCustomer"; customerDetails: CustomerDetails }
  | { type: "updateLineItem"; id: string; patch: Partial<Omit<LineItem, "id">> }
  | { type: "appendLineItem"; item: LineItem }
  | { type: "removeLineItem"; id: string }
  | {
      type: "repriceLineItems";
      savedItems: SavedItem[];
      fromTierId: string | null;
      toTierId: string | null;
    };

/** A stored invoice: the id is the URL key; the editable fields live in the draft. */
export interface Invoice {
  id: string;
  draft: InvoiceDraft;
  payments: Payment[];
}

export type InvoiceStatus = "unpaid" | "overdue" | "paid";

/** Row shape for the invoice list, derived from an Invoice. */
export interface InvoiceSummary {
  id: string;
  isQuote: boolean;
  invoiceNumber: string;
  customerName: string;
  /** ISO date, YYYY-MM-DD. */
  issueDate: string;
  /** ISO date, YYYY-MM-DD. */
  dueDate: string;
  totalCents: number;
  paidCents: number;
}
