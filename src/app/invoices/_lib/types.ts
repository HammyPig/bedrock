export type PaymentTerms = "due_on_receipt" | "net_7" | "net_14" | "net_30" | "custom";

export type CustomerTier = "tier_1" | "tier_2" | "tier_3";

export type DiscountMode = "percent" | "fixed";

export interface Discount {
  mode: DiscountMode;
  /** Percent (0-100) when mode is "percent", cents when mode is "fixed". */
  value: number;
}

export interface LineItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  /** Per-line discount, 0-100. */
  discountPercent: number;
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
  /** Pricing tier; "" means unassigned. */
  tier: CustomerTier | "";
  billingAddress: Address;
  deliveryAddress: Address;
}

/** The invoice's own billing-details snapshot — editing it never touches the saved customer. */
export type BillTo = Omit<Customer, "id">;

export interface InvoiceDraft {
  invoiceNumber: string;
  billTo: BillTo;
  /** Saved customer these details were filled from; null for walk-up/manual entry. */
  sourceCustomerId: string | null;
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
  paidCents: number;
  notes: string;
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
  billTo?: string;
  lineItems?: string;
  invalidLineItemIds: string[];
}

export type InvoiceAction =
  | { type: "patch"; patch: Partial<InvoiceDraft> }
  | { type: "patchBillTo"; patch: Partial<BillTo> }
  | { type: "fillBillToFromCustomer"; customer: Customer }
  | { type: "updateLineItem"; id: string; patch: Partial<Omit<LineItem, "id">> }
  | { type: "appendLineItem"; item: LineItem }
  | { type: "removeLineItem"; id: string };

/** A stored invoice: the id is the URL key; everything else lives in the draft. */
export interface Invoice {
  id: string;
  draft: InvoiceDraft;
}

export type InvoiceStatus = "unpaid" | "overdue" | "paid";

/** Row shape for the invoice list, derived from an Invoice. */
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  customerName: string;
  /** ISO date, YYYY-MM-DD. */
  issueDate: string;
  /** ISO date, YYYY-MM-DD. */
  dueDate: string;
  totalCents: number;
  paidCents: number;
}
