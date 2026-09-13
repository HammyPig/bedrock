import { z } from "zod";

import { type Discount, type DiscountMode, type LineItemBase, type Totals } from "./types";

/**
 * Rates are stored in basis points — hundredths of a percent — so no rate is
 * ever a float. 10% is 1000; 100%, the largest a rate can be, is 10000.
 */
export const BASIS_POINTS_PER_PERCENT = 100;

/** Quantities are stored in thousandths of a unit, so 2.5 is 2500. */
export const MILLI_PER_UNIT = 1000;
export const MAX_BASIS_POINTS = 100 * BASIS_POINTS_PER_PERCENT;

/**
 * The rules a stored quantity and rate are held to — shared, like centsSchema,
 * by the routers and the inputs that write them.
 */
export const quantityMilliSchema = z.number().int().positive();
export const basisPointsSchema = z.number().int().min(0).max(MAX_BASIS_POINTS);

/** The only tax rate the app charges: a business is registered for GST or it isn't. */
export const GST_RATE_BASIS_POINTS = 10 * BASIS_POINTS_PER_PERCENT;

/** A quantity as the units it reads as: 2500 -> "2.5", 3000 -> "3". */
export function formatQuantity(quantityMilli: number): string {
  return String(quantityMilli / MILLI_PER_UNIT);
}

/** A rate as the percent it reads as: 1000 -> "10", 3333 -> "33.33". */
export function formatBasisPoints(basisPoints: number): string {
  return String(basisPoints / BASIS_POINTS_PER_PERCENT);
}

/**
 * The shape the money math needs. Structural rather than Pick<InvoiceDraft, ...>
 * so purchase orders can use it too.
 */
interface TaxableDocument {
  lineItems: LineItemBase[];
  discount: Discount | null;
  deliveryCents: number;
  deliveryTaxBasisPoints: number;
}

/** The cents a single line contributes, each derived from a percent on the line. */
export interface LineBreakdown {
  discountCents: number;
  subtotalCents: number;
  taxCents: number;
}

/** Every cents figure a document records, derived from the percents it stores. */
export interface Breakdown {
  lines: LineBreakdown[];
  /** The document-level discount, in cents — for a percent discount and a
   * fixed one alike, so what was taken off is recorded either way. */
  discountCents: number;
  deliveryTaxCents: number;
  totals: Totals;
}

/** The lines' combined subtotal, before any document-level discount. */
export function subtotalCents(lineItems: LineItemBase[]): number {
  return lineItems.reduce((sum, item) => sum + lineItemSubtotalCents(item), 0);
}

/** How a discount was asked for — read off the discount rather than stored beside it. */
export function discountMode(discount: Discount): DiscountMode {
  return discount.basisPoints > 0 ? "percent" : "fixed";
}

/**
 * What a discount actually takes off: a percent of the subtotal, or the amount
 * given — never more than there is to discount. The clamp is the reason a
 * stored amountCents can be trusted as-is.
 */
export function discountAmountCents(discount: Discount, subtotal: number): number {
  const cents =
    discount.basisPoints > 0
      ? Math.round((subtotal * discount.basisPoints) / MAX_BASIS_POINTS)
      : discount.amountCents;
  return Math.min(cents, subtotal);
}

/**
 * A discount with its cents brought back in step with the lines it comes off.
 * Both form reducers run every action through this, so a draft's amountCents is
 * always what would actually be taken off — no percent left pointing at a stale
 * subtotal, no fixed amount larger than the invoice.
 */
export function resolveDiscount(
  discount: Discount | null,
  lineItems: LineItemBase[],
): Discount | null {
  if (discount === null) return null;
  const amountCents = discountAmountCents(discount, subtotalCents(lineItems));
  return amountCents === discount.amountCents ? discount : { ...discount, amountCents };
}

/** Line subtotal: qty x unit price, less the per-line discount. */
export function lineItemSubtotalCents(item: LineItemBase): number {
  // Divided down to cents before the rate is applied: the product of two
  // integers is exact, and only this last step rounds.
  const grossCents = (item.quantityMilli * item.unitPriceCents) / MILLI_PER_UNIT;
  return Math.round(grossCents * (1 - item.discountBasisPoints / MAX_BASIS_POINTS));
}

/** What the per-line discount took off — the gap to the undiscounted line, so the two reconcile exactly. */
export function lineItemDiscountCents(item: LineItemBase): number {
  const grossCents = Math.round((item.quantityMilli * item.unitPriceCents) / MILLI_PER_UNIT);
  return grossCents - lineItemSubtotalCents(item);
}

/** The rate a document is written at; a fresh one with no lines falls back to its delivery rate. */
export function documentTaxBasisPoints(
  doc: Pick<TaxableDocument, "lineItems" | "deliveryTaxBasisPoints">,
) {
  return doc.lineItems[0]?.taxBasisPoints ?? doc.deliveryTaxBasisPoints;
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
  const subtotal = lineSubtotals.reduce((sum, cents) => sum + cents, 0);

  // Re-derived rather than read off the draft, so a client can't bank a
  // discount that disagrees with the percent it claims to come from.
  const discountCents = doc.discount === null ? 0 : discountAmountCents(doc.discount, subtotal);

  const discountShares = allocateCents(discountCents, lineSubtotals);
  const lines = doc.lineItems.map((item, i) => {
    const lineSubtotalCents = lineSubtotals[i] ?? 0;
    const taxableCents = lineSubtotalCents - (discountShares[i] ?? 0);
    return {
      discountCents: lineItemDiscountCents(item),
      subtotalCents: lineSubtotalCents,
      taxCents: Math.round((taxableCents * item.taxBasisPoints) / MAX_BASIS_POINTS),
    };
  });

  const deliveryTaxCents = Math.round(
    (doc.deliveryCents * doc.deliveryTaxBasisPoints) / MAX_BASIS_POINTS,
  );
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0) + deliveryTaxCents;
  const totalCents = subtotal - discountCents + doc.deliveryCents + taxCents;

  return {
    lines,
    discountCents,
    deliveryTaxCents,
    totals: {
      subtotalCents: subtotal,
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
