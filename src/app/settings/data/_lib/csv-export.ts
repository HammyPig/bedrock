import Papa from "papaparse";

import { paymentsTotalCents } from "~/app/invoices/_lib/money";
import { type Customer, type Invoice, type Tier } from "~/app/invoices/_lib/types";
import { type SavedItem } from "~/lib/items";
import { customerImportFields, ITEM_FIELDS, itemTierFields } from "./csv-import";

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Tier prices and cost use 0 for "unset" — export those as blank rather than 0.00. */
function optionalDollars(cents: number): string {
  return cents === 0 ? "" : dollars(cents);
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Export headers are the import field labels (in field order), so a Bedrock
 * export re-imports with every column auto-mapped. Tier columns exist only
 * while Tiered pricing is on — pass the tiers to export a price column each.
 */
export function itemsCsv(items: SavedItem[], tiers: Tier[]): string {
  return Papa.unparse({
    fields: [...ITEM_FIELDS, ...itemTierFields(tiers)].map((field) => field.label),
    data: items.map((item) => [
      item.sku,
      item.name,
      item.vendor,
      item.barcode,
      dollars(item.unitPriceCents),
      optionalDollars(item.costCents),
      ...tiers.map((tier) => optionalDollars(item.tierPrices[tier.id] ?? 0)),
    ]),
  });
}

/** tiers null = Tiered pricing off: the Tier column is omitted entirely. */
export function customersCsv(customers: Customer[], tiers: Tier[] | null): string {
  const tierName = (tierId: string | null) =>
    tierId === null ? "" : (tiers?.find((tier) => tier.id === tierId)?.name ?? "");
  return Papa.unparse({
    fields: customerImportFields(tiers).map((field) => field.label),
    data: customers.map((customer) => [
      customer.name,
      customer.company,
      customer.phone,
      customer.email,
      ...(tiers === null ? [] : [tierName(customer.tierId)]),
      customer.billingAddress.line1,
      customer.billingAddress.line2,
      customer.billingAddress.suburb,
      customer.billingAddress.state,
      customer.billingAddress.postcode,
      customer.deliveryAddress.line1,
      customer.deliveryAddress.line2,
      customer.deliveryAddress.suburb,
      customer.deliveryAddress.state,
      customer.deliveryAddress.postcode,
    ]),
  });
}

const INVOICE_EXPORT_FIELDS = [
  "Invoice number",
  "Type",
  "Issue date",
  "Customer",
  "Company",
  "Email",
  "Terms",
  "Custom due date",
  "SKU",
  "Item",
  "Quantity",
  "Unit price",
  "Line discount %",
  "Backordered",
  "Freight",
  "Tax rate %",
  "Discount mode",
  "Discount value",
  "Paid",
  "Notes",
];

/** One row per line item; invoice-level fields repeat on each of its rows. */
export function invoicesCsv(invoices: Invoice[]): string {
  const sorted = [...invoices].sort(
    (a, b) =>
      a.draft.issueDate.localeCompare(b.draft.issueDate) ||
      a.draft.invoiceNumber.localeCompare(b.draft.invoiceNumber),
  );
  const data = sorted.flatMap(({ draft, payments }) =>
    draft.lineItems.map((line) => [
      draft.invoiceNumber,
      draft.isQuote ? "quote" : "invoice",
      draft.issueDate,
      draft.customerDetails.name,
      draft.customerDetails.company,
      draft.customerDetails.email,
      draft.terms,
      draft.customDueDate ?? "",
      line.sku,
      line.name,
      String(line.quantity),
      dollars(line.unitPriceCents),
      String(line.discountPercent),
      line.backordered ? "yes" : "",
      dollars(draft.freightCents),
      String(draft.taxRatePercent),
      draft.discount?.mode ?? "",
      draft.discount === null
        ? ""
        : draft.discount.mode === "fixed"
          ? dollars(draft.discount.amountCents)
          : String(draft.discount.percent),
      dollars(paymentsTotalCents(payments)),
      draft.notes,
    ]),
  );
  return Papa.unparse({ fields: INVOICE_EXPORT_FIELDS, data });
}
