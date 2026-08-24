import { balanceCents, summarizeInvoice } from "~/app/invoices/_lib/invoices";
import { type Invoice, type InvoiceSummary } from "~/app/invoices/_lib/types";

/**
 * Invoices with money still owing, grouped by the saved customer they were
 * filled from and oldest first. Walk-up invoices have no customer to attribute
 * to, so they're left out — the invoices list is where those show up.
 */
export function openInvoicesByCustomer(invoices: Invoice[]): Map<string, InvoiceSummary[]> {
  const byCustomer = new Map<string, InvoiceSummary[]>();
  for (const invoice of invoices) {
    const customerId = invoice.draft.sourceCustomerId;
    if (customerId === null) continue;
    const summary = summarizeInvoice(invoice);
    if (balanceCents(summary) <= 0) continue;
    byCustomer.set(customerId, [...(byCustomer.get(customerId) ?? []), summary]);
  }
  for (const open of byCustomer.values()) {
    open.sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber),
    );
  }
  return byCustomer;
}

export function outstandingCents(invoices: InvoiceSummary[]): number {
  return invoices.reduce((sum, invoice) => sum + balanceCents(invoice), 0);
}
