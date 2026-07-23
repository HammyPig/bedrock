"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatIsoDate, todayIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { cn } from "~/lib/utils";
import {
  balanceCents,
  invoiceStatus,
  STATUS_FILTER_OPTIONS,
  STATUS_LABELS,
  summarizeInvoice,
  type StatusFilter,
} from "../_lib/invoices";
import { mockInvoices } from "../_lib/mock-data";
import { type InvoiceStatus } from "../_lib/types";

const invoiceSummaries = mockInvoices.map(summarizeInvoice);

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  unpaid: "bg-muted text-muted-foreground",
  overdue: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
};

export function InvoicesList() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const today = todayIsoDate();
  const tokens = tokenize(query);

  const rows = invoiceSummaries
    .map((invoice) => ({ invoice, status: invoiceStatus(invoice, today) }))
    .filter(
      ({ invoice, status }) =>
        (statusFilter === "all" || status === statusFilter) &&
        matchesAllTokens([invoice.invoiceNumber, invoice.customerName], tokens),
    )
    .sort(
      (a, b) =>
        b.invoice.issueDate.localeCompare(a.invoice.issueDate) ||
        b.invoice.invoiceNumber.localeCompare(a.invoice.invoiceNumber),
    );

  const outstandingCents = rows.reduce((sum, { invoice }) => sum + balanceCents(invoice), 0);

  const countLabel =
    rows.length === invoiceSummaries.length
      ? `${rows.length} invoice${rows.length === 1 ? "" : "s"}`
      : `${rows.length} of ${invoiceSummaries.length} invoices`;

  const emptyMessage =
    invoiceSummaries.length === 0
      ? "No invoices yet. Create your first invoice."
      : rows.length === 0
        ? "No invoices match your filters."
        : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground text-sm">
            {"Everything you've billed, and what's still owing."}
          </p>
        </div>
        <Button asChild>
          <Link href="/invoices/new">
            <PlusIcon />
            New invoice
          </Link>
        </Button>
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-8 sm:p-10">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Input
              className="max-w-xs"
              value={query}
              placeholder="Search by number or customer..."
              aria-label="Search invoices"
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className="w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground ml-auto text-sm tabular-nums">
              {countLabel}
              {outstandingCents > 0 && ` · ${formatCents(outstandingCents)} outstanding`}
            </span>
          </div>
          {emptyMessage ? (
            <p className="text-muted-foreground py-8 text-center text-sm">{emptyMessage}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pr-4 pb-2 font-medium">Invoice</th>
                  <th className="pr-4 pb-2 font-medium">Customer</th>
                  <th className="pr-4 pb-2 font-medium">Issued</th>
                  <th className="pr-4 pb-2 font-medium">Due</th>
                  <th className="pr-4 pb-2 text-right font-medium">Total</th>
                  <th className="pr-4 pb-2 text-right font-medium">Balance</th>
                  <th className="pb-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ invoice, status }) => {
                  const balance = balanceCents(invoice);

                  return (
                    <tr
                      key={invoice.id}
                      className="hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0"
                      onClick={() => router.push(`/invoices/${invoice.id}/edit`)}
                    >
                      <td className="py-3 pr-4 font-medium whitespace-nowrap">
                        {/* Real link inside the clickable row, for middle-click and keyboard users. */}
                        <Link
                          href={`/invoices/${invoice.id}/edit`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </td>
                      <td className="max-w-52 truncate py-3 pr-4">{invoice.customerName}</td>
                      <td className="text-muted-foreground py-3 pr-4 whitespace-nowrap">
                        {formatIsoDate(invoice.issueDate)}
                      </td>
                      <td className="text-muted-foreground py-3 pr-4 whitespace-nowrap">
                        {formatIsoDate(invoice.dueDate)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {formatCents(invoice.totalCents)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {balance > 0 ? formatCents(balance) : "—"}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                            STATUS_BADGE[status],
                          )}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
