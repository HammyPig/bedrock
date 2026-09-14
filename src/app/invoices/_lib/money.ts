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
  // Divided down to cents before the rate is applied: the product of two
  // integers is exact, and only this last step rounds.
  const grossCents = (item.quantityMilli * item.unitPriceCents) / MILLI_PER_UNIT;
  return Math.round(grossCents * (1 - (item.discountBasisPoints ?? 0) / MAX_BASIS_POINTS));
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
 * part of that total which is tax. Lines and delivery each keep their own rate,
 * so the document discount is shared out over the lines before their GST is
 * taken; the GST is added up unrounded and rounded once for the whole document,
 * per the ATO's total invoice rule. With every rate at 10%, it is the total ÷ 11.
 */
export function computeTotals(doc: TaxableDocument, paidCents = 0): Totals {
  const lineSubtotals = doc.lineItems.map(lineItemSubtotalCents);
  const subtotal = lineSubtotals.reduce((sum, cents) => sum + cents, 0);

  // Re-derived rather than read off the draft, so a percent discount can't come
  // to cents that disagree with its rate.
  const discountCents = doc.discount === null ? 0 : discountAmountCents(doc.discount, subtotal);

  // What is left of each line once the document discount is shared out.
  const keptShare = subtotal === 0 ? 0 : (subtotal - discountCents) / subtotal;
  const lineTax = doc.lineItems.reduce(
    (sum, item, i) =>
      sum + includedTaxCents((lineSubtotals[i] ?? 0) * keptShare, item.taxBasisPoints),
    0,
  );
  const taxCents = Math.round(
    lineTax + includedTaxCents(doc.deliveryCents, doc.deliveryTaxBasisPoints),
  );
  const totalCents = subtotal - discountCents + doc.deliveryCents;

  return {
    subtotalCents: subtotal,
    discountCents,
    taxCents,
    totalCents,
    balanceCents: totalCents - paidCents,
  };
}
