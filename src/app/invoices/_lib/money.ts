import { type Discount, type LineItemBase, type Totals } from "./types";

/** Line subtotal: qty x unit price, less the per-line discount. */
export function lineItemSubtotalCents(item: LineItemBase): number {
  return Math.round(item.quantity * item.unitPriceCents * (1 - item.discountPercent / 100));
}

/** The invoice's paid total: the sum of its recorded payments. */
export function paymentsTotalCents(payments: { amountCents: number }[]): number {
  return payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

// Structural rather than Pick<InvoiceDraft, ...> so purchase orders can use it too.
export function computeTotals(
  draft: {
    lineItems: LineItemBase[];
    discount: Discount | null;
    freightCents: number;
    taxRatePercent: number;
  },
  paidCents = 0,
): Totals {
  const subtotalCents = draft.lineItems.reduce((sum, item) => sum + lineItemSubtotalCents(item), 0);

  let discountCents = 0;
  if (draft.discount) {
    discountCents =
      draft.discount.mode === "percent"
        ? Math.round((subtotalCents * draft.discount.percent) / 100)
        : Math.min(draft.discount.amountCents, subtotalCents);
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
    balanceCents: totalCents - paidCents,
  };
}
