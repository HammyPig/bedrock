"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { BackLink } from "~/components/back-link";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { fieldMatchesAnyToken, matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import { Highlight } from "./highlight";

/** Floating switcher beside the edit form: every invoice, searchable like the customer picker. */
export function InvoiceSidebar() {
  const { invoiceId: activeInvoiceId } = useParams<{ invoiceId: string }>();
  const router = useRouter();
  const rootRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  const [invoices] = api.invoice.list.useSuspenseQuery();
  // Same newest-first ordering as the invoices list, so switching feels consistent.
  const sidebarInvoices = invoices
    .map(({ id, draft }) => ({
      id,
      invoiceNumber: draft.invoiceNumber,
      issueDate: draft.issueDate,
      billTo: draft.billTo,
    }))
    .sort(
      (a, b) =>
        b.issueDate.localeCompare(a.issueDate) || b.invoiceNumber.localeCompare(a.invoiceNumber),
    );

  const filtered = sidebarInvoices.filter(({ invoiceNumber, billTo }) =>
    matchesAllTokens(
      [invoiceNumber, billTo.name, billTo.company, billTo.phone, billTo.email],
      tokens,
    ),
  );

  // Centre the current invoice on first mount only: the sidebar lives in the (editor)
  // layout and survives invoice switches, so later scrolling belongs to the user.
  useEffect(() => {
    const root = rootRef.current;
    const list = root?.querySelector<HTMLElement>('[data-slot="command-list"]');
    const active = root?.querySelector<HTMLElement>('[data-checked="true"]');
    if (!list || !active) return;
    const offset =
      active.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTop = offset - list.clientHeight / 2 + active.clientHeight / 2;
  }, []);

  return (
    <aside ref={rootRef} className="sticky top-10 mt-10 w-52 self-start">
      {/* h-8 + mb-6 mirror the form title's 2rem line and mb-6, so the card tops align. */}
      <div className="mb-6 flex h-8 items-center">
        <BackLink href="/invoices">All invoices</BackLink>
      </div>
      <Command shouldFilter={false} className="border shadow-sm">
        <CommandInput placeholder="Search invoices..." value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[50vh]">
          <CommandEmpty>No invoices found.</CommandEmpty>
          {filtered.length > 0 && (
            <CommandGroup>
              {filtered.map((invoice) => {
                // Second line: whichever customer details matched the search, like the customer picker.
                const matchedDetails = [
                  invoice.billTo.name,
                  invoice.billTo.company,
                  invoice.billTo.phone,
                  invoice.billTo.email,
                ].filter((field) => field.trim() !== "" && fieldMatchesAnyToken(field, tokens));

                return (
                  <CommandItem
                    key={invoice.id}
                    value={invoice.id}
                    data-checked={invoice.id === activeInvoiceId}
                    onSelect={() => router.push(`/invoices/${invoice.id}/edit`)}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate tabular-nums">
                        <Highlight text={invoice.invoiceNumber} tokens={tokens} />
                      </span>
                      {matchedDetails.length > 0 && (
                        <span className="text-muted-foreground truncate text-xs">
                          {matchedDetails.map((text, index) => (
                            <Fragment key={text}>
                              {index > 0 && " · "}
                              <Highlight text={text} tokens={tokens} />
                            </Fragment>
                          ))}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </aside>
  );
}
