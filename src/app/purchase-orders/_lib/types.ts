import { type Address, type Discount, type LineItem } from "~/app/invoices/_lib/types";

/** A saved vendor the business orders from. */
export interface Vendor {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  address: Address;
}

/** The purchase order's own vendor snapshot — editing it never touches the saved vendor. */
export type VendorDetails = Omit<Vendor, "id">;

export interface PurchaseOrderDraft {
  poNumber: string;
  vendor: VendorDetails;
  /** Saved vendor these details were filled from; null for manual entry. */
  sourceVendorId: string | null;
  /** ISO date, YYYY-MM-DD. */
  orderDate: string;
  /** Expected delivery date, ISO YYYY-MM-DD; null when unknown. */
  expectedDate: string | null;
  lineItems: LineItem[];
  discount: Discount | null;
  freightCents: number;
  taxRatePercent: number;
  notes: string;
}

export interface PurchaseOrderDraftErrors {
  poNumber?: string;
  vendor?: string;
  lineItems?: string;
  invalidLineItemIds: string[];
}

export type PurchaseOrderAction =
  | { type: "patch"; patch: Partial<PurchaseOrderDraft> }
  | { type: "patchVendor"; patch: Partial<VendorDetails> }
  | { type: "fillVendorFromSaved"; vendor: Vendor }
  | { type: "updateLineItem"; id: string; patch: Partial<Omit<LineItem, "id">> }
  | { type: "appendLineItem"; item: LineItem }
  | { type: "removeLineItem"; id: string };

/** A stored purchase order: the id is the URL key; everything else lives in the draft. */
export interface PurchaseOrder {
  id: string;
  draft: PurchaseOrderDraft;
}

/** Row shape for the purchase orders list, derived from a PurchaseOrder. */
export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  vendorName: string;
  /** ISO date, YYYY-MM-DD. */
  orderDate: string;
  expectedDate: string | null;
  totalCents: number;
}
