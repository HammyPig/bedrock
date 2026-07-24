import { addressesEqual, addressHasContent, emptyAddress } from "~/app/invoices/_lib/invoice";
import { computeTotals } from "~/app/invoices/_lib/money";
import { type Totals } from "~/app/invoices/_lib/types";
import {
  type PurchaseOrder,
  type PurchaseOrderDraft,
  type PurchaseOrderDraftErrors,
  type PurchaseOrderSummary,
  type Vendor,
  type VendorDetails,
} from "./types";

export function emptyVendorDetails(): VendorDetails {
  return { name: "", company: "", phone: "", email: "", address: emptyAddress() };
}

export function vendorMatchesSaved(details: VendorDetails, vendor: Vendor): boolean {
  return (
    details.name === vendor.name &&
    details.company === vendor.company &&
    details.phone === vendor.phone &&
    details.email === vendor.email &&
    addressesEqual(details.address, vendor.address)
  );
}

export function vendorHasContent(details: VendorDetails): boolean {
  return (
    [details.name, details.company, details.phone, details.email].some(
      (value) => value.trim() !== "",
    ) || addressHasContent(details.address)
  );
}

/** Display label for a vendor or vendor snapshot: contact name, falling back to company. */
export function vendorDisplayName(vendor: Pick<Vendor, "name" | "company">): string {
  if (vendor.name.trim() !== "") return vendor.name;
  if (vendor.company.trim() !== "") return vendor.company;
  return "Unnamed vendor";
}

/** Purchase orders reuse the invoice totals math with nothing paid; balanceCents is unused. */
export function purchaseOrderTotals(
  draft: Pick<PurchaseOrderDraft, "lineItems" | "discount" | "freightCents" | "taxRatePercent">,
): Totals {
  return computeTotals({ ...draft, paidCents: 0 });
}

export function validateDraft(draft: PurchaseOrderDraft): PurchaseOrderDraftErrors | null {
  const invalidLineItemIds = draft.lineItems
    .filter((item) => item.name.trim() === "" || item.quantity <= 0)
    .map((item) => item.id);

  const errors: PurchaseOrderDraftErrors = { invalidLineItemIds };
  if (draft.poNumber.trim() === "") {
    errors.poNumber = "Purchase order number is required.";
  }
  if (draft.vendor.name.trim() === "" && draft.vendor.company.trim() === "") {
    errors.vendor = "Vendor details need at least a name or company.";
  }
  if (invalidLineItemIds.length > 0) {
    errors.lineItems = "Each line item needs a name and a quantity above zero.";
  }

  return errors.poNumber || errors.vendor || errors.lineItems ? errors : null;
}

export function summarizePurchaseOrder({ id, draft }: PurchaseOrder): PurchaseOrderSummary {
  return {
    id,
    poNumber: draft.poNumber,
    vendorName: vendorDisplayName(draft.vendor),
    orderDate: draft.orderDate,
    expectedDate: draft.expectedDate,
    totalCents: purchaseOrderTotals(draft).totalCents,
  };
}
