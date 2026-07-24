"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { customerDisplayName } from "~/app/invoices/_lib/invoice";
import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";

export function CustomersList() {
  const router = useRouter();
  const [customers] = api.customer.list.useSuspenseQuery();
  const [query, setQuery] = useState("");

  const tokens = tokenize(query);
  const rows = customers.filter((customer) =>
    matchesAllTokens([customer.name, customer.company, customer.phone, customer.email], tokens),
  );

  const countLabel =
    rows.length === customers.length
      ? `${customers.length} customer${customers.length === 1 ? "" : "s"}`
      : `${rows.length} of ${customers.length} customers`;

  const emptyMessage =
    customers.length === 0
      ? "No customers yet. Add your first customer."
      : rows.length === 0
        ? "No customers match your search."
        : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <BackLink href="/">Home</BackLink>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-muted-foreground text-sm">The people and businesses you invoice.</p>
        </div>
        <Button asChild>
          <Link href="/customers/new">
            <PlusIcon />
            New customer
          </Link>
        </Button>
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-8 sm:p-10">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Input
              className="max-w-xs"
              value={query}
              placeholder="Search by name, company, or email..."
              aria-label="Search customers"
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <span className="text-muted-foreground text-sm tabular-nums">{countLabel}</span>
          </div>
          {emptyMessage ? (
            <p className="text-muted-foreground py-8 text-center text-sm">{emptyMessage}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pr-4 pb-2 font-medium">Name</th>
                  <th className="pr-4 pb-2 font-medium">Company</th>
                  <th className="pr-4 pb-2 font-medium">Phone</th>
                  <th className="pb-2 font-medium">Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((customer) => (
                  <tr
                    key={customer.id}
                    className="hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0"
                    onClick={() => router.push(`/customers/${customer.id}/edit`)}
                  >
                    <td className="max-w-48 truncate py-3 pr-4 font-medium">
                      {/* Real link inside the clickable row, for middle-click and keyboard users. */}
                      <Link
                        href={`/customers/${customer.id}/edit`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {customerDisplayName(customer)}
                      </Link>
                    </td>
                    {/* The display name already falls back to company when the name is empty. */}
                    <td className="text-muted-foreground max-w-40 truncate py-3 pr-4">
                      {customer.name.trim() === "" ? "" : customer.company}
                    </td>
                    <td className="text-muted-foreground py-3 pr-4 whitespace-nowrap">
                      {customer.phone}
                    </td>
                    <td className="text-muted-foreground max-w-48 truncate py-3">
                      {customer.email}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
