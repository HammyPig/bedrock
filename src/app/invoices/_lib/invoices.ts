import { customerDisplayName, deriveDueDate } from "./invoice";
import { computeTotals } from "./money";
import { type Invoice, type InvoiceStatus, type InvoiceSummary } from "./types";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  unpaid: "Unpaid",
  overdue: "Overdue",
  paid: "Paid",
};

export type StatusFilter = InvoiceStatus | "all";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

export function summarizeInvoice({ id, draft }: Invoice): InvoiceSummary {
  return {
    id,
    invoiceNumber: draft.invoiceNumber,
    customerName: customerDisplayName(draft.billTo),
    issueDate: draft.issueDate,
    dueDate:
      draft.terms === "custom"
        ? (draft.customDueDate ?? draft.issueDate)
        : deriveDueDate(draft.issueDate, draft.terms),
    totalCents: computeTotals(draft).totalCents,
    paidCents: draft.paidCents,
  };
}

export function balanceCents(invoice: InvoiceSummary): number {
  return invoice.totalCents - invoice.paidCents;
}

/**
 * Status is derived, not stored: paid once the balance hits zero, overdue once
 * the due date has passed. ISO dates compare correctly as plain strings.
 */
export function invoiceStatus(invoice: InvoiceSummary, todayIso: string): InvoiceStatus {
  if (invoice.paidCents >= invoice.totalCents) return "paid";
  return invoice.dueDate < todayIso ? "overdue" : "unpaid";
}
