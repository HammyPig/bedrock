import { type Discount, type LineItemBase, type Totals } from "./types";

/** The only tax rate the app charges: a business is registered for GST or it isn't. */
export const GST_RATE_PERCENT = 10;

/**
 * The shape the money math needs. Structural rather than Pick<InvoiceDraft, ...>
 * so purchase orders can use it too.
 */
interface TaxableDocument {
  lineItems: LineItemBase[];
  discount: Discount | null;
  deliveryCents: number;
  deliveryTaxPercent: number;
}

/** The tax a single line contributes, derived from the rate on the line. */
export interface LineBreakdown {
  taxCents: number;
}

/** Every cents figure a document records, derived from the percents it stores. */
export interface Breakdown {
  lines: LineBreakdown[];
  deliveryTaxCents: number;
  totals: Totals;
}

/** Line subtotal: qty x unit price, less the per-line discount. */
export function lineItemSubtotalCents(item: LineItemBase): number {
  return Math.round(item.quantity * item.unitPriceCents * (1 - item.discountPercent / 100));
}

/** The rate a document is written at; a fresh one with no lines falls back to its delivery rate. */
export function documentTaxPercent(doc: Pick<TaxableDocument, "lineItems" | "deliveryTaxPercent">) {
  return doc.lineItems[0]?.taxPercent ?? doc.deliveryTaxPercent;
}

/** The invoice's paid total: the sum of its recorded payments. */
export function paymentsTotalCents(payments: { amountCents: number }[]): number {
  return payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

/**
 * Splits an amount across weighted parts in whole cents. Each part is floored
 * to its share and the rounding remainder lands on the last, so the parts
 * always add back up to the amount.
 */
function allocateCents(amountCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const shares = weights.map((weight) => Math.floor((amountCents * weight) / totalWeight));
  const remainder = amountCents - shares.reduce((sum, share) => sum + share, 0);
  return shares.map((share, i) => (i === shares.length - 1 ? share + remainder : share));
}

/**
 * Resolves a document's percents into the cents it stores. Tax is charged per
 * line: a document-level discount comes off the lines it was given against, so
 * it is shared out across them before they are taxed, and delivery — part of
 * the GST base — is taxed on its own. Total tax is then exactly the sum of the
 * line tax and the delivery tax, with no invoice-level rate to reconcile.
 */
export function computeBreakdown(doc: TaxableDocument, paidCents = 0): Breakdown {
  const lineSubtotals = doc.lineItems.map(lineItemSubtotalCents);
  const subtotalCents = lineSubtotals.reduce((sum, cents) => sum + cents, 0);

  let discountCents = 0;
  if (doc.discount) {
    discountCents =
      doc.discount.mode === "percent"
        ? Math.round((subtotalCents * doc.discount.percent) / 100)
        : Math.min(doc.discount.amountCents, subtotalCents);
  }

  const discountShares = allocateCents(discountCents, lineSubtotals);
  const lines = doc.lineItems.map((item, i) => {
    const taxableCents = (lineSubtotals[i] ?? 0) - (discountShares[i] ?? 0);
    return { taxCents: Math.round((taxableCents * item.taxPercent) / 100) };
  });

  const deliveryTaxCents = Math.round((doc.deliveryCents * doc.deliveryTaxPercent) / 100);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0) + deliveryTaxCents;
  const totalCents = subtotalCents - discountCents + doc.deliveryCents + taxCents;

  return {
    lines,
    deliveryTaxCents,
    totals: {
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      balanceCents: totalCents - paidCents,
    },
  };
}

export function computeTotals(doc: TaxableDocument, paidCents = 0): Totals {
  return computeBreakdown(doc, paidCents).totals;
}
