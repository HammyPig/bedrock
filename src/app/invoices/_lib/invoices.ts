import { customerDisplayName, deriveDueDate } from "./invoice";
import { computeTotals, paymentsTotalCents } from "./money";
import { type Invoice, type InvoiceStatus, type InvoiceSummary } from "./types";

/** What the list's status column shows: quotes get their own badge instead of a payment status. */
export type ListStatus = InvoiceStatus | "quote";

export const STATUS_LABELS: Record<ListStatus, string> = {
  unpaid: "Unpaid",
  overdue: "Overdue",
  paid: "Paid",
  quote: "Quote",
};

export type StatusFilter = ListStatus | "all";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "quote", label: "Quotes" },
];

export function summarizeInvoice({ id, draft, payments }: Invoice): InvoiceSummary {
  return {
    id,
    isQuote: draft.isQuote,
    invoiceNumber: draft.invoiceNumber,
    customerName: customerDisplayName(draft.billTo),
    issueDate: draft.issueDate,
    dueDate:
      draft.terms === "custom"
        ? (draft.customDueDate ?? draft.issueDate)
        : deriveDueDate(draft.issueDate, draft.terms),
    totalCents: computeTotals(draft).totalCents,
    paidCents: paymentsTotalCents(payments),
  };
}

/** Quotes aren't payable, so nothing is owing on them. */
export function balanceCents(invoice: InvoiceSummary): number {
  return invoice.isQuote ? 0 : invoice.totalCents - invoice.paidCents;
}

/**
 * Status is derived, not stored: paid once the balance hits zero, overdue once
 * the due date has passed. ISO dates compare correctly as plain strings.
 */
export function invoiceStatus(invoice: InvoiceSummary, todayIso: string): InvoiceStatus {
  if (invoice.paidCents >= invoice.totalCents) return "paid";
  return invoice.dueDate < todayIso ? "overdue" : "unpaid";
}

/** Status shown in the list: quotes get a flat "quote" badge instead of a payment status. */
export function listStatus(invoice: InvoiceSummary, todayIso: string): ListStatus {
  return invoice.isQuote ? "quote" : invoiceStatus(invoice, todayIso);
}
