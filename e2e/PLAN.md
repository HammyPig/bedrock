# Invoice E2E Spec

The test suite is the specification. Where a test and the code disagree, the
test is right and the code changes to match.

This document holds only what the suite cannot say for itself: why it is shaped
this way, which disagreements are deliberate, and what bit while it was written.
**The suite is the index of behaviour** — `bun run e2e --list` prints every
specified behaviour by id. Nothing here restates it, so nothing here goes stale
when a test is added.

## Philosophy

### Two tiers

Every assertion is either an **invariant** or an **interaction design** decision,
and the distinction decides what a red test means.

|           | Invariant (Tier 1)                                     | Interaction design (Tier 2)                      |
| --------- | ------------------------------------------------------ | ------------------------------------------------ |
| Covers    | money math, dates, validation, persistence round-trips | layout, modes, toggles, focus behaviour, wording |
| Red means | a bug — fix the code                                   | a decision — change the test, then the code      |
| Written   | before the code                                        | once the interaction has been looked at          |
| Lives in  | `unit/`, `tests/invoice-persistence.spec.ts`           | the per-section spec files                       |

Tier 1 is nameable in the abstract, so it is written first and dictates the
design. Tier 2 is a ratchet: it pins an interaction once decided so it cannot
drift. Specifying feel before looking at it only means rewriting the test twice.

### Arithmetic does not go through a browser

`computeTotals`, `lineItemSubtotalCents`, `deriveDueDate` and `validateDraft` are
pure functions. Driving them through the DOM costs seconds per case — the
dev-only tRPC middleware alone adds 100-500ms per procedure — which caps how many
cases anyone bothers writing.

They get table-driven specs with no browser. The e2e suite then carries exactly
**one** wiring test per calculation (T5): the number on screen is the number the
calculator produced. The arithmetic itself is never re-derived through the DOM.

### Failing tests are the point

Unbuilt behaviour gets its spec written in full and marked `test.fixme` — the
body is the specification, and skipping keeps the suite fast. A suite that burns
a 30s timeout per unbuilt feature is a suite nobody runs.

`test.fail` is for behaviour that exists and is wrong: it runs, is required to
fail, and flips red the moment the code is fixed. That is the signal to delete
the marker.

## Mechanics

### Layout

```
e2e/
  global.setup.ts        creates the database, pushes schema, seeds the session
  support/
    env.ts               ports and the _test database URL
    db.ts                the seeded tenant; opens Postgres at import time
    drafts.ts            InvoiceDraft builders — no database, safe for unit/
    fixtures.ts          seeded customers, catalog items and invoices
    invoice-page.ts      shared locators and interaction helpers
    trpc.ts              the httpBatchStreamLink wire format, for route mocks
    pdf.ts               text extraction from an exported PDF
  unit/                  no browser, no database
  tests/                 browser, seeded session
```

`support/drafts.ts` is deliberately separate from `support/db.ts`: that file
opens a Postgres connection at module scope, and importing it would defeat the
point of a database-free unit project.

### Projects

Three: `unit` (no `dependencies`, no `storageState`), `setup`, and `chromium`
scoped to `tests/`. `bun run e2e` runs everything; `bun run e2e:unit` sets
`E2E_UNIT_ONLY=1`, which skips `webServer` — Playwright's is global with no
per-project override, so without it a sub-second suite waits on a cold Next.js.

### Fixtures

`resetBusinessData()` runs in `beforeEach` and wipes everything but the tenant.
Rows go in through `testDb` rather than the UI, so an invoice test never fails
because the customer page is broken; only tests _about_ creating a customer
create one through the UI.

Fixtures are fixed, named, and deliberately awkward — a customer with a delivery
address and one without, one with no email, two items whose SKUs overlap by
prefix, amounts that round at a half-cent.

### Selectors

Role and accessible-name queries throughout, which double as an accessibility
check — that is how C19 was found. **No `data-testid` was needed**, including on
the totals panel, which was the expected exception: each row owns its amount as a
direct child span, so it can be reached structurally.

Two traps, both already handled in `invoice-page.ts`:

- `Line N ...` labels are **positional**. After a reorder, `Line 1 quantity` is a
  different item, so order is read from the DOM via `lineNames`, never from the
  labels.
- The delivery checkbox and the collapsed delivery address input share the label
  text "Delivery address". `getByLabel` matches both; `addressInput` goes by role.

### Interaction helpers that exist for a reason

- **`fillAndCommit`** — the numeric cells swap to raw text on focus and commit on
  blur. It clicks first so that swap settles, then fills, then blurs. A bare
  `fill` can be overwritten by the re-render it triggers.
- **`replaceText`** — a controlled field can re-render between the select and the
  insert that make up a fill, landing new text beside the old
  (`"ReplacedOriginal"`). Retrying the fill and its check together rides it out.
  Use it wherever a test overwrites a field that already holds something.
- **`trpcRequest`** — the customer writes fire on blur, so they are in flight by
  the time focus has moved, and a database read straight afterwards races them.
  It waits on the **request**, never the response: `httpBatchStreamLink` flushes
  headers before the procedure resolves and holds the stream open after it, so
  `waitForResponse` returns too early, `response.body()` throws once anything
  navigates, and `response.finished()` never settles. The request leaving is the
  app's half of the bargain. That a record now _exists_ is a separate claim, read
  back through the picker, which lists what the server has — and anything that
  navigates or reloads must wait for that readback first, or it aborts the very
  write it was about to check for.
- **`saveNewInvoice`** — creating an invoice redirects to its own edit page.
  Without waiting for that, the next navigation races it and lands back on
  `/invoices/new`.

## Deliberate disagreements with the code

Eleven gaps, ordered by how much they change. Four are `test.fail` (the
behaviour exists and is wrong); the rest are `test.fixme` (it does not exist
yet).

1. **Live duplicate invoice number warning** (Mt6-Mt8) — a client-side check
   against `api.invoice.list`, excluding the invoice being edited. Today the only
   feedback is a server `CONFLICT` thrown on save, which Mt9 covers.
2. **Line reorder** (L13, P6) — a `moveLineItem` reducer action plus move up/down
   controls. Drag is deliberately _not_ the design: it is the flakiest
   interaction in Playwright, and buttons are keyboard-accessible for free.
3. **Locked toggle message** (L12) — the button is `disabled`, which makes it
   unhoverable, unfocusable and untestable. Keep it interactive with
   `aria-disabled` and an inline message on click.
4. **Switching customer resets the delivery checkbox** (C15) — one line in the
   `fillBillToFromCustomer` branch of the reducer, which today replaces the
   whole bill-to but leaves both delivery flags where they were.
5. **"Delivery" label on invoices** (T4b, X6) — relabel the invoice totals row
   _and_ its PDF line; they have to change together, which is why it is spec'd
   twice. `freightCents` stays as the internal name and the purchase order keeps
   saying "Freight" — see the naming decision below.
6. **Payment method** (T12) — `bedrock_payment` has no method column. Spec only;
   the schema change waits, since `db:push` reaches every Conductor workspace's
   shared Postgres.
7. **Feedback when emailing a new invoice** (E5) — Save + email on an unsaved
   invoice creates it, which redirects and mounts a fresh form. The send result
   dies with the old one, so neither a confirmation nor a failure reaches the
   person who pressed the button. Only the already-saved path, which updates in
   place, reports anything.
8. **An accessible name on the customer picker** (C25) — `role="combobox"` is not
   a name-from-content role, so the trigger's visible "Search customers…" never
   reaches the accessibility tree and it announces as an unlabelled combobox. It
   needs an `aria-label`; the compact switcher that replaces it has the same
   problem.
9. **Zero-line validation** (V5) — the server refuses an invoice with no lines
   (`lineItems` is `.min(1)`) but `validateDraft` lets it through, so that path
   would meet a raw Zod error rather than a written message. Unreachable from the
   grid today, which always keeps one row (L8), so it is latent rather than live.
10. **The customer's saved delivery address as the default** (C17) — picking a
    customer who has one should preselect it rather than "same as billing".
11. **Restoring that address once it is changed** (C20) — a "Use saved address"
    button, shown only while the delivery address differs from the customer's.

Both delivery gaps were briefly built in 60d85ba and went out with its revert.
They are spec'd rather than rebuilt because delivery was explicitly out of scope
for the customer-section rework — see the decision below.

## Decisions

- **The customer section** — every invoice bills a **saved** customer, and a
  customer exists if you could find them again: one of name, company, phone or
  email, which is exactly the set the picker searches. An address is not an
  identity. That rule replaces the older name-or-company check (V2), and it is
  what lets a cash job be billed to a phone number instead of an invented name.

  Creating and editing are deliberately asymmetric, because they answer
  different questions. A new customer has no record to contradict, so it saves
  itself on blur (C5) — but only once it has an identity (C7). The search text
  is the decision, and the focus that lands in the field it was routed into is
  the chance to refine it, not a condition of keeping it (C6): what was typed
  survives even if the invoice ends up billed to somebody else. That does leave
  pairs to tidy up, which is the merge feature's job rather than the front
  door's. An existing customer does have a record, and the invoice keeps
  its own snapshot of them (P4), so an edit raises the "Edited" menu and waits
  (C9). Saving the invoice is the last moment they are demonstrably finished, so
  it asks once there (C12) and does not ask again (C13).

  There is no "save as new customer". It is the control that manufactures
  duplicates, and merging them back is the expensive half. Duplicates are
  expected — a one-field identity bar guarantees them — and the answer is a
  merge feature, not a narrower front door.

  A read-only view with an Edit/Cancel toggle was built (60d85ba) and reverted.
  It made the write-back unambiguous, which was the right instinct, but it
  charged a round trip for every one-character fix and spent a third of the
  section on four labelled rows restating details the user already knew.
  Divergence is now resolved at save time instead, which costs the common path
  nothing.

- **Delivery is out of scope of that rework** — it is the order's, not the
  customer's, and it was left exactly as it is rather than moved or re-tangled.
  C17 and C20 above say what it should do; nothing in the customer rework
  touches it.

- **Native date input** (Mt5) — the issue date stays an `<input type="date">`.
  Tests set its value; they never drive the browser's calendar popup.
- **Naming** — the invoice says **"Delivery"**, the purchase order keeps
  **"Freight"**, and the shared `freightCents` field is not renamed. The two
  documents point opposite ways: an invoice bills a customer, where "freight" is
  trade jargon on a consumer document and clashes with the "Delivery address"
  toggle directly above it; a purchase order is a wholesaler billing us, where
  freight is standard. Renaming the column would mean a migration on the Postgres
  shared by every Conductor workspace and a changed CSV export header, for no
  gain.
- **Email is asserted at the mutation, not the send** — the send happens
  server-side through Resend, so there is no request to Resend a browser test can
  intercept. E1 route-mocks `invoice.sendEmail`; E2 and E3 need no mock at all,
  since the missing-email check runs before the configuration check and the suite
  runs with credentials blanked. Reaching further would need an E2E-only branch
  inside `src/server/email.tsx`, which is rejected: a test-only branch in
  production code is what makes a suite untrustworthy.
- **Out of scope, deliberate** — P.O. #, the GST rate field and tiered pricing
  repricing are implemented but unspecified, and so unprotected. Revisit when
  they next change.

## What bit, and what was measured

- **`pdfjs-dist` needs coaxing outside a browser**: the legacy build, no
  `workerSrc` so it runs in-thread, and `standardFontDataUrl` pointed at its own
  `standard_fonts/` — without which extraction fails on the fonts a PDF names
  rather than embeds. All contained in `support/pdf.ts`. Extraction yields
  positioned fragments, not lines, so assertions are on what the document says,
  not how it is laid out.
- **The PDF export is a blob-URL anchor click** that revokes the object URL on
  the next line
  ([invoice-form.tsx:190-209](../src/app/invoices/_components/invoice-form.tsx#L190-L209)),
  which looked like a race. Measured rather than assumed: eight consecutive runs
  all raised a download event with the right filename, no failure, and a
  well-formed PDF. `page.waitForEvent("download")` is sound. The downloaded file
  lives in a temp directory that goes when the browser context closes, so a test
  must read it before finishing.
- **The suite is serial** (`workers: 1`, one shared seeded business). Fine at this
  size. When it hurts, the fix is a business per worker, not a database per
  worker.
- **Address suggestions are faker mock data** with a fixed seed
  (`src/app/invoices/_lib/mock-data.ts`). Tests can rely on them, but they pin
  mock behaviour — re-check when a real lookup service lands.
- **The sandbox blocks binding the e2e port.** Browser runs need it disabled.
