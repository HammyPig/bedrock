"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import { summarizePurchaseOrder } from "../_lib/purchase-order";

export function PurchaseOrdersList() {
  const router = useRouter();
  const [purchaseOrders] = api.purchaseOrder.list.useSuspenseQuery();
  const [query, setQuery] = useState("");

  const summaries = purchaseOrders.map(summarizePurchaseOrder);

  const tokens = tokenize(query);

  const rows = summaries
    .filter((order) => matchesAllTokens([order.poNumber, order.vendorName], tokens))
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.poNumber.localeCompare(a.poNumber));

  const countLabel =
    rows.length === summaries.length
      ? `${rows.length} purchase order${rows.length === 1 ? "" : "s"}`
      : `${rows.length} of ${summaries.length} purchase orders`;

  const emptyMessage =
    summaries.length === 0
      ? "No purchase orders yet. Create your first purchase order."
      : rows.length === 0
        ? "No purchase orders match your search."
        : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-4">
        <BackLink href="/">Home</BackLink>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Purchase orders</h1>
          <p className="text-muted-foreground text-sm">
            {"Everything you've ordered from your vendors."}
          </p>
        </div>
        <Button asChild>
          <Link href="/purchase-orders/new">
            <PlusIcon />
            New purchase order
          </Link>
        </Button>
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-8 sm:p-10">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Input
              className="max-w-xs"
              value={query}
              placeholder="Search by number or vendor..."
              aria-label="Search purchase orders"
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <span className="text-muted-foreground ml-auto text-sm tabular-nums">{countLabel}</span>
          </div>
          {emptyMessage ? (
            <p className="text-muted-foreground py-8 text-center text-sm">{emptyMessage}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pr-4 pb-2 font-medium">Purchase order</th>
                  <th className="pr-4 pb-2 font-medium">Vendor</th>
                  <th className="pr-4 pb-2 font-medium">Ordered</th>
                  <th className="pr-4 pb-2 font-medium">Expected</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0"
                    onClick={() => router.push(`/purchase-orders/${order.id}/edit`)}
                  >
                    <td className="py-3 pr-4 font-medium whitespace-nowrap">
                      {/* Real link inside the clickable row, for middle-click and keyboard users. */}
                      <Link
                        href={`/purchase-orders/${order.id}/edit`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {order.poNumber}
                      </Link>
                    </td>
                    <td className="max-w-52 truncate py-3 pr-4">{order.vendorName}</td>
                    <td className="text-muted-foreground py-3 pr-4 whitespace-nowrap">
                      {formatIsoDate(order.orderDate)}
                    </td>
                    <td className="text-muted-foreground py-3 pr-4 whitespace-nowrap">
                      {order.expectedDate === null ? "—" : formatIsoDate(order.expectedDate)}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCents(order.totalCents)}
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
