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

/** A line as the money math reads it: only invoice lines carry a per-line discount. */
type PricedLine = LineItemBase & { discountBasisPoints?: number };

/**
 * The shape the money math needs. Structural rather than Pick<InvoiceDraft, ...>
 * so purchase orders can use it too.
 */
interface TaxableDocument {
  lineItems: PricedLine[];
  discount: Discount | null;
  deliveryCents: number;
  deliveryTaxBasisPoints: number;
}

/** The lines' combined subtotal, before any document-level discount. */
export function subtotalCents(lineItems: PricedLine[]): number {
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
  lineItems: PricedLine[],
): Discount | null {
  if (discount === null) return null;
  const amountCents = discountAmountCents(discount, subtotalCents(lineItems));
  return amountCents === discount.amountCents ? discount : { ...discount, amountCents };
}

/**
 * The discount cents a document stores: a fixed discount's amount, and nothing
 * for a percent one, whose cents are worked out from its rate whenever it's read.
 */
export function storedDiscountCents(discount: Discount | null, lineItems: PricedLine[]): number {
  return discount === null || discountMode(discount) === "percent"
    ? 0
    : discountAmountCents(discount, subtotalCents(lineItems));
}

/** Line subtotal: qty x unit price, less the per-line discount. */
export function lineItemSubtotalCents(item: PricedLine): number {
  // Whole numbers until a single division, so a half cent comes out as exactly
  // half and rounds up. Scaling by (1 - rate) first can't promise that: most
  // rates, like 67%, have no exact binary fraction and land just under the half.
  const keptBasisPoints = MAX_BASIS_POINTS - (item.discountBasisPoints ?? 0);
  return Math.round(
    (item.quantityMilli * item.unitPriceCents * keptBasisPoints) /
      (MILLI_PER_UNIT * MAX_BASIS_POINTS),
  );
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

/** The GST inside a GST-inclusive amount, unrounded: rate ÷ (100% + rate) of it, so 1/11 at 10%. */
function includedTaxCents(amountCents: number, taxBasisPoints: number): number {
  return (amountCents * taxBasisPoints) / (MAX_BASIS_POINTS + taxBasisPoints);
}

/**
 * Works out a document's totals from the rates it stores. Prices include GST,
 * so the total is the lines less the discount, plus delivery, and GST is the
 * part of that total which is tax. A document is taxed at a single rate — 10%
 * when the business is registered for GST, otherwise nothing — so GST is taken
 * once from the whole total: the total ÷ 11 at 10%.
 */
export function computeTotals(doc: TaxableDocument, paidCents = 0): Totals {
  const subtotal = subtotalCents(doc.lineItems);

  // Re-derived rather than read off the draft, so a percent discount can't come
  // to cents that disagree with its rate.
  const discountCents = doc.discount === null ? 0 : discountAmountCents(doc.discount, subtotal);

  const totalCents = subtotal - discountCents + doc.deliveryCents;
  const taxCents = Math.round(includedTaxCents(totalCents, documentTaxBasisPoints(doc)));

  return {
    subtotalCents: subtotal,
    discountCents,
    taxCents,
    totalCents,
    balanceCents: totalCents - paidCents,
  };
}
