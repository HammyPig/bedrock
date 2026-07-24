"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatCents } from "~/lib/money";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";

export function ItemsList() {
  const router = useRouter();
  const [items] = api.item.list.useSuspenseQuery();
  const [query, setQuery] = useState("");

  const tokens = tokenize(query);
  const rows = items.filter((item) => matchesAllTokens([item.sku, item.name], tokens));

  const countLabel =
    rows.length === items.length
      ? `${items.length} item${items.length === 1 ? "" : "s"}`
      : `${rows.length} of ${items.length} items`;

  const emptyMessage =
    items.length === 0
      ? "No items yet. Add your first item."
      : rows.length === 0
        ? "No items match your search."
        : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <BackLink href="/">Home</BackLink>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Items</h1>
          <p className="text-muted-foreground text-sm">
            The products and services you add to invoices.
          </p>
        </div>
        <Button asChild>
          <Link href="/items/new">
            <PlusIcon />
            New item
          </Link>
        </Button>
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-8 sm:p-10">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Input
              className="max-w-xs"
              value={query}
              placeholder="Search by SKU or name..."
              aria-label="Search items"
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
                  <th className="pr-4 pb-2 font-medium">SKU</th>
                  <th className="pr-4 pb-2 font-medium">Name</th>
                  <th className="pb-2 text-right font-medium">Unit price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0"
                    onClick={() => router.push(`/items/${item.id}/edit`)}
                  >
                    <td className="py-3 pr-4 font-medium whitespace-nowrap">
                      {/* Real link inside the clickable row, for middle-click and keyboard users. */}
                      <Link
                        href={`/items/${item.id}/edit`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.sku}
                      </Link>
                    </td>
                    <td className="max-w-96 truncate py-3 pr-4">{item.name}</td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCents(item.unitPriceCents)}
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
