import Papa from "papaparse";

import { formatBasisPoints, formatQuantity, paymentsTotalCents } from "~/app/invoices/_lib/money";
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
  "Line GST %",
  "Backordered",
  "Delivery",
  "Delivery GST %",
  "Discount %",
  "Discount",
  "Paid",
  "Payment methods",
  "Notes",
];

/**
 * One row per line item; invoice-level fields repeat on each of its rows.
 * includePaid false = Payments off: the Paid and Payment methods columns are omitted entirely.
 */
export function invoicesCsv(invoices: Invoice[], includePaid: boolean): string {
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
      formatQuantity(line.quantityMilli),
      dollars(line.unitPriceCents),
      formatBasisPoints(line.discountBasisPoints),
      formatBasisPoints(line.taxBasisPoints),
      line.backordered ? "yes" : "",
      dollars(draft.deliveryCents),
      formatBasisPoints(draft.deliveryTaxBasisPoints),
      draft.discount === null ? "" : formatBasisPoints(draft.discount.basisPoints),
      draft.discount === null ? "" : dollars(draft.discount.amountCents),
      ...(includePaid
        ? [
            dollars(paymentsTotalCents(payments)),
            [...new Set(payments.map((payment) => payment.method))].join("; "),
          ]
        : []),
      draft.notes,
    ]),
  );
  const fields = includePaid
    ? INVOICE_EXPORT_FIELDS
    : INVOICE_EXPORT_FIELDS.filter((field) => field !== "Paid" && field !== "Payment methods");
  return Papa.unparse({ fields, data });
}
