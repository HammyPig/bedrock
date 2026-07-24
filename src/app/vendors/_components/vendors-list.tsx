"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { vendorDisplayName } from "~/app/purchase-orders/_lib/purchase-order";
import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";

export function VendorsList() {
  const router = useRouter();
  const [vendors] = api.vendor.list.useSuspenseQuery();
  const [query, setQuery] = useState("");

  const tokens = tokenize(query);
  const rows = vendors.filter((vendor) =>
    matchesAllTokens([vendor.name, vendor.company, vendor.phone, vendor.email], tokens),
  );

  const countLabel =
    rows.length === vendors.length
      ? `${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`
      : `${rows.length} of ${vendors.length} vendors`;

  const emptyMessage =
    vendors.length === 0
      ? "No vendors yet. Add your first vendor."
      : rows.length === 0
        ? "No vendors match your search."
        : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <BackLink href="/">Home</BackLink>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground text-sm">The suppliers you order from.</p>
        </div>
        <Button asChild>
          <Link href="/vendors/new">
            <PlusIcon />
            New vendor
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
              aria-label="Search vendors"
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
                {rows.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className="hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0"
                    onClick={() => router.push(`/vendors/${vendor.id}/edit`)}
                  >
                    <td className="max-w-48 truncate py-3 pr-4 font-medium">
                      {/* Real link inside the clickable row, for middle-click and keyboard users. */}
                      <Link
                        href={`/vendors/${vendor.id}/edit`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {vendorDisplayName(vendor)}
                      </Link>
                    </td>
                    {/* The display name already falls back to company when the name is empty. */}
                    <td className="text-muted-foreground max-w-40 truncate py-3 pr-4">
                      {vendor.name.trim() === "" ? "" : vendor.company}
                    </td>
                    <td className="text-muted-foreground py-3 pr-4 whitespace-nowrap">
                      {vendor.phone}
                    </td>
                    <td className="text-muted-foreground max-w-48 truncate py-3">{vendor.email}</td>
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
