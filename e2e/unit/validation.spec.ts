import { expect, test } from "@playwright/test";

import { validateDraft } from "~/app/invoices/_lib/invoice";
import { customerDetails, draft, line } from "../support/drafts";

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
    expect(validateDraft(draft({ invoiceNumber: "", isQuote: true }))?.invoiceNumber).toBe(
      "Quote number is required.",
    );
  });
});

test.describe("V2 the invoice needs someone to bill", () => {
  /** Nobody: the four fields that could identify a customer are all empty. */
  const nobody = { name: "", company: "", phone: "", email: "" };

  test("no name, company, phone or email is rejected", () => {
    expect(
      validateDraft(draft({ customerDetails: customerDetails(nobody) }))?.customerDetails,
    ).toBe("Select a customer to bill.");
  });

  /**
   * A customer exists if you could find them again, and the picker searches
   * exactly these four. A phone number alone is a thin record, but it is a real
   * one — it is how a cash job gets invoiced without inventing a name.
   */
  const enough = [
    { what: "a name", override: { name: "Dana Reyes" } },
    { what: "a company", override: { company: "Reyes Building" } },
    { what: "a phone number", override: { phone: "0433 777 888" } },
    { what: "an email address", override: { email: "dana@reyes.example" } },
  ];

  for (const { what, override } of enough) {
    test(`${what} alone is enough`, () => {
      expect(
        validateDraft(draft({ customerDetails: customerDetails({ ...nobody, ...override }) })),
      ).toBeNull();
    });
  }

  test("an address is not an identity", () => {
    const billingAddress = {
      line1: "9 Bay Street",
      line2: "",
      suburb: "Ultimo",
      state: "NSW",
      postcode: "2007",
    };
    expect(
      validateDraft(draft({ customerDetails: customerDetails({ ...nobody, billingAddress }) }))
        ?.customerDetails,
    ).toBe("Select a customer to bill.");
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
