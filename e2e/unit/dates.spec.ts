import { expect, test } from "@playwright/test";

import { deriveDueDate, draftDueDate } from "~/app/invoices/_lib/invoice";
import { addDaysIso, parseIsoDate, toIsoDate } from "~/lib/dates";
import { draft } from "../support/drafts";

/** D1-D5. Payment terms decide the due date; ISO dates are local, never UTC. */

const ISSUE_DATE = "2026-08-26";

test("D1 due on receipt is due the day it is issued", () => {
  expect(deriveDueDate(ISSUE_DATE, "due_on_receipt")).toBe(ISSUE_DATE);
});

test.describe("D2 net terms add their days", () => {
  const cases = [
    { terms: "net_7", due: "2026-09-02" },
    { terms: "net_14", due: "2026-09-09" },
    { terms: "net_30", due: "2026-09-25" },
  ] as const;

  for (const { terms, due } of cases) {
    test(`${terms} from ${ISSUE_DATE} is due ${due}`, () => {
      expect(deriveDueDate(ISSUE_DATE, terms)).toBe(due);
    });
  }
});

test.describe("D3 custom terms", () => {
  test("use the date entered", () => {
    expect(draftDueDate(draft({ terms: "custom", customDueDate: "2026-12-01" }))).toBe(
      "2026-12-01",
    );
  });

  test("fall back to the issue date when none has been entered", () => {
    expect(draftDueDate(draft({ terms: "custom", customDueDate: null }))).toBe(ISSUE_DATE);
  });

  test("are ignored while the terms are not custom", () => {
    expect(draftDueDate(draft({ terms: "net_7", customDueDate: "2026-12-01" }))).toBe("2026-09-02");
  });
});

test.describe("D4 due dates cross calendar boundaries", () => {
  const cases = [
    { from: "2026-01-31", days: 7, to: "2026-02-07", why: "into the next month" },
    { from: "2026-12-28", days: 7, to: "2027-01-04", why: "into the next year" },
    { from: "2026-02-25", days: 7, to: "2026-03-04", why: "over a 28-day February" },
    { from: "2028-02-25", days: 7, to: "2028-03-03", why: "over a leap-year February" },
  ];

  for (const { from, days, to, why } of cases) {
    test(`${from} + ${days} days lands on ${to}, ${why}`, () => {
      expect(addDaysIso(from, days)).toBe(to);
    });
  }
});

test.describe("D5 ISO dates are parsed as local time", () => {
  // A bare new Date("YYYY-MM-DD") parses as UTC, which reads back a day early
  // anywhere behind it. These assertions hold in every timezone.
  test("the parsed date keeps the calendar day it was given", () => {
    const parsed = parseIsoDate("2026-08-26");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7); // zero-based: August
    expect(parsed.getDate()).toBe(26);
  });

  const roundTrips = [
    "2026-01-01",
    "2026-04-05", // AEDT ends
    "2026-08-26",
    "2026-10-04", // AEDT starts
    "2026-12-31",
    "2028-02-29", // leap day
  ];

  for (const iso of roundTrips) {
    test(`${iso} survives a parse and format round trip`, () => {
      expect(toIsoDate(parseIsoDate(iso))).toBe(iso);
    });
  }

  test("adding zero days changes nothing", () => {
    expect(addDaysIso("2026-10-04", 0)).toBe("2026-10-04");
  });
});
