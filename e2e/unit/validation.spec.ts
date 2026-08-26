import { expect, test } from "@playwright/test";

import { validateDraft } from "~/app/invoices/_lib/invoice";
import { billTo, draft, line } from "../support/drafts";

/** V1-V4. What stops an invoice being saved, and the wording the user sees. */

test.describe("V1 the document number is required", () => {
  test("an empty invoice number is rejected", () => {
    expect(validateDraft(draft({ invoiceNumber: "" }))?.invoiceNumber).toBe(
      "Invoice number is required.",
    );
  });

  test("whitespace alone is not a number", () => {
    expect(validateDraft(draft({ invoiceNumber: "   " }))?.invoiceNumber).toBe(
      "Invoice number is required.",
    );
  });

  test("a quote is told it needs a quote number", () => {
    expect(validateDraft(draft({ invoiceNumber: "", documentType: "quote" }))?.invoiceNumber).toBe(
      "Quote number is required.",
    );
  });
});

test.describe("V2 the invoice needs someone to bill", () => {
  test("neither a name nor a company is rejected", () => {
    expect(validateDraft(draft({ billTo: billTo({ name: "", company: "" }) }))?.billTo).toBe(
      "Select a customer to bill.",
    );
  });

  test("a company alone is enough", () => {
    expect(
      validateDraft(draft({ billTo: billTo({ name: "", company: "Reyes Building" }) })),
    ).toBeNull();
  });

  test("a name alone is enough", () => {
    expect(
      validateDraft(draft({ billTo: billTo({ name: "Dana Reyes", company: "" }) })),
    ).toBeNull();
  });
});

test.describe("V3 every line needs a name and a quantity", () => {
  test("a line with no name is flagged by id", () => {
    const unnamed = line({ name: "" });
    const errors = validateDraft(draft({ lineItems: [unnamed] }));
    expect(errors?.invalidLineItemIds).toEqual([unnamed.id]);
    expect(errors?.lineItems).toBe("Each line item needs a name and a quantity above zero.");
  });

  test("a line with no quantity is flagged", () => {
    const empty = line({ quantity: 0 });
    expect(validateDraft(draft({ lineItems: [empty] }))?.invalidLineItemIds).toEqual([empty.id]);
  });

  test("a negative quantity is flagged", () => {
    const negative = line({ quantity: -1 });
    expect(validateDraft(draft({ lineItems: [negative] }))?.invalidLineItemIds).toEqual([
      negative.id,
    ]);
  });

  test("only the offending lines are flagged", () => {
    const good = line({ name: "Callout fee" });
    const bad = line({ name: "" });
    expect(validateDraft(draft({ lineItems: [good, bad] }))?.invalidLineItemIds).toEqual([bad.id]);
  });
});

test("V4 a complete draft has nothing to report", () => {
  expect(validateDraft(draft())).toBeNull();
});

test("V5 an invoice with no line items is rejected", () => {
  // The server already refuses this (`lineItems` is `.min(1)`), but validateDraft
  // lets it through, so the user would meet a raw Zod error instead of a written
  // message. Unreachable from the grid today, which always keeps one row (L8) —
  // latent until some other path builds a draft.
  test.fail();
  expect(validateDraft(draft({ lineItems: [] }))?.lineItems).toBe(
    "An invoice needs at least one line item.",
  );
});
