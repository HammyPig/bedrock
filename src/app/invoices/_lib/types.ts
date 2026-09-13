import { type SavedItem } from "~/lib/items";

export type PaymentTerms = "due_on_receipt" | "net_7" | "net_14" | "net_30" | "custom";

/** A pricing tier as the UI needs it (Tiered pricing module). */
export interface Tier {
  id: string;
  name: string;
}

/** How a discount was asked for. Derived from the discount itself — never stored. */
export type DiscountMode = "percent" | "fixed";

/**
 * A discount. amountCents is always what actually comes off, so the money is
 * readable without re-running the math; basisPoints records how it was asked
 * for, and is 0 when it was entered as a straight amount.
 */
export interface Discount {
  basisPoints: number;
  amountCents: number;
}

/** Line-item fields shared with purchase orders. */
export interface LineItemBase {
  id: string;
  sku: string;
  name: string;
  /** Quantity in thousandths of a unit, so 2.5 is 2500 — no float in the money path. */
  quantityMilli: number;
  unitPriceCents: number;
  /** GST rate applied to this line, in basis points. Never edited — it is the
   * business's rate, captured when the line was written, so a saved document
   * keeps its own. */
  taxBasisPoints: number;
}

export interface LineItem extends LineItemBase {
  /** Per-line discount in basis points, 0-10000; 0 when none was given (Line discounts module). */
  discountBasisPoints: number;
  /** On backorder — still billed on this invoice, ships separately (Backorders module). */
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
  /** The customer billed. Null only mid-edit, while a new one is being typed
   * in — their record is created, and this filled, on save. */
  customerId: string | null;
  /** Per-invoice fulfillment flags — not part of the customer snapshot. */
  hasDeliveryAddress: boolean;
  deliverySameAsBilling: boolean;
  /** ISO date, YYYY-MM-DD. */
  issueDate: string;
  terms: PaymentTerms;
  /** Only used when terms is "custom". */
  customDueDate: string | null;
  lineItems: LineItem[];
  discount: Discount | null;
  deliveryCents: number;
  /** GST rate applied to delivery, in basis points; the same rate the lines were written at. */
  deliveryTaxBasisPoints: number;
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
