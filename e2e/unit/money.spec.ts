import { expect, test } from "@playwright/test";

import {
  computeTotals,
  lineItemSubtotalCents,
  paymentsTotalCents,
} from "~/app/invoices/_lib/money";
import { draft, line } from "../support/drafts";

/**
 * M1-M9. The invoice's arithmetic, tested directly rather than through the DOM.
 * The UI carries exactly one wiring test (T5) that the number on screen is the
 * number these functions produced.
 */

test.describe("M1 line subtotal", () => {
  test("is quantity x unit price", () => {
    expect(lineItemSubtotalCents(line({ quantity: 3, unitPriceCents: 1050 }))).toBe(3150);
  });

  test("applies the per-line discount percent", () => {
    expect(
      lineItemSubtotalCents(line({ quantity: 3, unitPriceCents: 1050, discountPercent: 10 })),
    ).toBe(2835);
  });

  test("allows a fractional quantity", () => {
    expect(lineItemSubtotalCents(line({ quantity: 2.5, unitPriceCents: 400 }))).toBe(1000);
  });

  test("a 100% line discount bills nothing", () => {
    expect(
      lineItemSubtotalCents(line({ quantity: 3, unitPriceCents: 1050, discountPercent: 100 })),
    ).toBe(0);
  });
});

test("M2 the invoice subtotal is the sum of its line subtotals", () => {
  const totals = computeTotals(
    draft({
      lineItems: [
        line({ quantity: 3, unitPriceCents: 1050 }), // 3150
        line({ quantity: 2.5, unitPriceCents: 400 }), // 1000
      ],
    }),
  );
  expect(totals.subtotalCents).toBe(4150);
});

test("M3 a percent discount comes off the subtotal", () => {
  const totals = computeTotals(
    draft({
      lineItems: [line({ unitPriceCents: 10_000 })],
      discount: { mode: "percent", value: 15 },
    }),
  );
  expect(totals.discountCents).toBe(1500);
});

test.describe("M4 a fixed discount", () => {
  test("comes off the subtotal at face value", () => {
    const totals = computeTotals(
      draft({
        lineItems: [line({ unitPriceCents: 10_000 })],
        discount: { mode: "fixed", value: 2500 },
      }),
    );
    expect(totals.discountCents).toBe(2500);
  });

  test("clamps at the subtotal rather than driving the total negative", () => {
    const totals = computeTotals(
      draft({
        lineItems: [line({ unitPriceCents: 5000 })],
        discount: { mode: "fixed", value: 999_999 },
      }),
    );
    expect(totals.discountCents).toBe(5000);
    expect(totals.totalCents).toBe(0);
  });

  test("clamps at the subtotal only — freight still bills and is still taxed", () => {
    const totals = computeTotals(
      draft({
        lineItems: [line({ unitPriceCents: 5000 })],
        discount: { mode: "fixed", value: 999_999 },
        freightCents: 1000,
        taxRatePercent: 10,
      }),
    );
    expect(totals.discountCents).toBe(5000);
    expect(totals.taxCents).toBe(100);
    expect(totals.totalCents).toBe(1100);
  });
});

test("M5 GST is charged on the discounted subtotal plus freight", () => {
  const totals = computeTotals(
    draft({
      lineItems: [line({ unitPriceCents: 12_000 })],
      discount: { mode: "fixed", value: 2000 },
      freightCents: 1000,
      taxRatePercent: 10,
    }),
  );
  // (12000 - 2000 + 1000) x 10%
  expect(totals.taxCents).toBe(1100);
});

test("M6 the total is subtotal less discount, plus freight, plus GST", () => {
  const totals = computeTotals(
    draft({
      lineItems: [line({ unitPriceCents: 10_000 })],
      freightCents: 1000,
      taxRatePercent: 10,
    }),
  );
  expect(totals).toMatchObject({
    subtotalCents: 10_000,
    discountCents: 0,
    taxCents: 1100,
    totalCents: 12_100,
  });
});

test.describe("M7 balance due", () => {
  const invoice = draft({
    lineItems: [line({ unitPriceCents: 10_000 })],
    freightCents: 1000,
    taxRatePercent: 10,
  });

  test("is the total less what has been paid", () => {
    expect(computeTotals(invoice, 5000).balanceCents).toBe(7100);
  });

  test("is zero once the total is paid", () => {
    expect(computeTotals(invoice, 12_100).balanceCents).toBe(0);
  });

  test("goes negative when the customer overpays", () => {
    expect(computeTotals(invoice, 15_000).balanceCents).toBe(-2900);
  });

  test("counts every recorded payment", () => {
    expect(paymentsTotalCents([{ amountCents: 2500 }, { amountCents: 1000 }])).toBe(3500);
    expect(paymentsTotalCents([])).toBe(0);
  });
});

test.describe("M8 half-cent amounts round up", () => {
  test("on a line discount", () => {
    // 101 x 50% = 50.5
    expect(lineItemSubtotalCents(line({ unitPriceCents: 101, discountPercent: 50 }))).toBe(51);
  });

  test("on an invoice percent discount", () => {
    const totals = computeTotals(
      draft({
        lineItems: [line({ unitPriceCents: 101 })],
        discount: { mode: "percent", value: 50 },
      }),
    );
    expect(totals.discountCents).toBe(51);
  });

  test("on GST", () => {
    // 105 x 10% = 10.5
    const totals = computeTotals(
      draft({ lineItems: [line({ unitPriceCents: 105 })], taxRatePercent: 10 }),
    );
    expect(totals.taxCents).toBe(11);
    expect(totals.totalCents).toBe(116);
  });
});

test.describe("M9 empty amounts total to zero, never NaN", () => {
  test("an invoice with no lines", () => {
    expect(computeTotals(draft({ lineItems: [] }))).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      totalCents: 0,
      balanceCents: 0,
    });
  });

  test("a line with no quantity", () => {
    expect(lineItemSubtotalCents(line({ quantity: 0, unitPriceCents: 10_000 }))).toBe(0);
  });

  test("a zero GST rate", () => {
    const totals = computeTotals(
      draft({ lineItems: [line({ unitPriceCents: 10_000 })], taxRatePercent: 0 }),
    );
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(10_000);
  });
});
