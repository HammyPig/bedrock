"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PencilLineIcon } from "lucide-react";

import { InvoiceStatusBadge } from "~/app/invoices/_components/invoice-status-badge";
import { customerDisplayName, formatAddressOneLine } from "~/app/invoices/_lib/invoice";
import { balanceCents, listStatus } from "~/app/invoices/_lib/invoices";
import { type Customer } from "~/app/invoices/_lib/types";
import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { formatIsoDate, todayIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { openInvoicesByCustomer, outstandingCents } from "../_lib/balances";

interface CustomerProfileProps {
  customer: Customer;
}

/**
 * A customer's contact details and what they owe. The open-invoice table is
 * read-only until "Record payment" switches it into a selection mode, so the
 * page reads as a view first and only acts on intent — like the Edit button.
 */
export function CustomerProfile({ customer }: CustomerProfileProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [invoices] = api.invoice.list.useSuspenseQuery();
  const modules = api.settings.modules.useQuery();
  const tiers = api.tier.list.useQuery(undefined, {
    enabled: modules.data?.tieredPricing === true,
  });
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const openInvoices = openInvoicesByCustomer(invoices).get(customer.id) ?? [];
  const owedCents = outstandingCents(openInvoices);
  const today = todayIsoDate();

  // Checked against the live list, so an invoice paid off elsewhere drops out of the selection.
  const selectedInvoices = openInvoices.filter((invoice) => selected.has(invoice.id));
  const selectedCents = outstandingCents(selectedInvoices);
  const allSelected = openInvoices.length > 0 && selectedInvoices.length === openInvoices.length;

  const stopRecording = () => {
    setRecording(false);
    setSelected(new Set());
  };

  const recordPayments = api.invoice.recordFullPayments.useMutation({
    onSuccess: async () => {
      stopRecording();
      await utils.invoice.invalidate();
    },
  });

  const startRecording = () => {
    recordPayments.reset();
    setSelected(new Set());
    setRecording(true);
  };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopRecording();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [recording]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(openInvoices.map((invoice) => invoice.id)));

  const tierName =
    customer.tierId === null
      ? ""
      : (tiers.data?.find((tier) => tier.id === customer.tierId)?.name ?? "");
  const details: { label: string; value: string }[] = [
    { label: "Phone", value: customer.phone },
    { label: "Email", value: customer.email },
    { label: "Billing address", value: formatAddressOneLine(customer.billingAddress) },
    { label: "Delivery address", value: formatAddressOneLine(customer.deliveryAddress) },
    ...(modules.data?.tieredPricing ? [{ label: "Tier", value: tierName }] : []),
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* The (editor) sidebar already shows this link at xl and up. */}
      <div className="mb-4 xl:hidden">
        <BackLink href="/customers">All customers</BackLink>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{customerDisplayName(customer)}</h1>
        {/* The heading already shows the company when the name is empty. */}
        {customer.name.trim() !== "" && customer.company.trim() !== "" && (
          <p className="text-muted-foreground mt-1 text-sm">{customer.company}</p>
        )}
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-8 p-8 sm:p-10">
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-medium">Details</h2>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link href={`/customers/${customer.id}/edit`}>
                  <PencilLineIcon />
                  Edit
                </Link>
              </Button>
            </div>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {details.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-sm">{value.trim() === "" ? "—" : value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <div>
                <h2 className="font-medium">Balance owed</h2>
                <p className="text-muted-foreground text-sm">
                  {openInvoices.length === 0
                    ? "Nothing owing."
                    : `${openInvoices.length} open invoice${openInvoices.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <span className="text-2xl font-semibold tabular-nums">{formatCents(owedCents)}</span>
            </div>
            {openInvoices.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    {recording && (
                      <th className="w-8 pb-2">
                        <Checkbox
                          aria-label="Select all open invoices"
                          checked={
                            allSelected
                              ? true
                              : selectedInvoices.length > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={toggleAll}
                        />
                      </th>
                    )}
                    <th className="pr-4 pb-2 font-medium">Invoice</th>
                    <th className="pr-4 pb-2 font-medium">Issued</th>
                    <th className="pr-4 pb-2 font-medium">Due</th>
                    <th className="pr-4 pb-2 text-right font-medium">Total</th>
                    <th className="pr-4 pb-2 text-right font-medium">Balance</th>
                    <th className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((invoice) => {
                    const checked = recording && selected.has(invoice.id);

                    return (
                      <tr
                        key={invoice.id}
                        className={cn(
                          "hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0",
                          checked && "bg-muted/30",
                        )}
                        // Outside the mode a row opens the invoice, like every other list.
                        onClick={() =>
                          recording
                            ? toggle(invoice.id)
                            : router.push(`/invoices/${invoice.id}/edit`)
                        }
                      >
                        {recording && (
                          <td className="py-3">
                            <Checkbox
                              aria-label={`Select ${invoice.invoiceNumber}`}
                              checked={checked}
                              onCheckedChange={() => toggle(invoice.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                        )}
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
                          {formatCents(balanceCents(invoice))}
                        </td>
                        <td className="py-3 text-right">
                          <InvoiceStatusBadge status={listStatus(invoice, today)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
        {openInvoices.length > 0 && (
          <div className="bg-card/95 sticky bottom-0 flex items-center justify-between gap-4 rounded-b-xl border-t px-8 py-4 backdrop-blur sm:px-10">
            {!recording ? (
              <Button className="ml-auto" onClick={startRecording}>
                Record payment
              </Button>
            ) : recordPayments.error ? (
              <p className="text-destructive text-sm">{recordPayments.error.message}</p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {selectedInvoices.length === 0
                  ? "Tick the invoices being paid."
                  : `${selectedInvoices.length} invoice${selectedInvoices.length === 1 ? "" : "s"} selected`}
              </p>
            )}
            {recording && (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={recordPayments.isPending}
                  onClick={stopRecording}
                >
                  Cancel
                </Button>
                <Button
                  disabled={selectedInvoices.length === 0 || recordPayments.isPending}
                  onClick={() =>
                    recordPayments.mutate({
                      invoiceIds: selectedInvoices.map((invoice) => invoice.id),
                      paidDate: today,
                    })
                  }
                >
                  {recordPayments.isPending
                    ? "Recording…"
                    : selectedCents > 0
                      ? `Record full payment · ${formatCents(selectedCents)}`
                      : "Record full payment"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
