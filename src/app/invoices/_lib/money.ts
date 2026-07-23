import { type InvoiceDraft, type LineItem, type Totals } from "./types";

/** Line subtotal: qty x unit price, less the per-line discount. */
export function lineItemSubtotalCents(item: LineItem): number {
  return Math.round(item.quantity * item.unitPriceCents * (1 - item.discountPercent / 100));
}

export function computeTotals(
  draft: Pick<
    InvoiceDraft,
    "lineItems" | "discount" | "freightCents" | "taxRatePercent" | "paidCents"
  >,
): Totals {
  const subtotalCents = draft.lineItems.reduce((sum, item) => sum + lineItemSubtotalCents(item), 0);

  let discountCents = 0;
  if (draft.discount) {
    discountCents =
      draft.discount.mode === "percent"
        ? Math.round((subtotalCents * draft.discount.value) / 100)
        : Math.min(draft.discount.value, subtotalCents);
  }

  // Freight is part of the GST base.
  const taxableCents = subtotalCents - discountCents + draft.freightCents;
  const taxCents = Math.round((taxableCents * draft.taxRatePercent) / 100);
  const totalCents = taxableCents + taxCents;

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    balanceCents: totalCents - draft.paidCents,
  };
}
