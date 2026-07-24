"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { Highlight } from "~/components/highlight";
import { Sidebar, sidebarItemClass } from "~/components/sidebar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { fieldMatchesAnyToken, matchesAllTokens, tokenize } from "~/lib/search";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/** Floating switcher beside the edit form: every purchase order, searchable like the vendor picker. */
export function PurchaseOrderSidebar() {
  const { purchaseOrderId: activePurchaseOrderId } = useParams<{ purchaseOrderId: string }>();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  const [purchaseOrders] = api.purchaseOrder.list.useSuspenseQuery();
  // Same newest-first ordering as the purchase orders list, so switching feels consistent.
  const sidebarOrders = purchaseOrders
    .map(({ id, draft }) => ({
      id,
      poNumber: draft.poNumber,
      orderDate: draft.orderDate,
      vendor: draft.vendor,
    }))
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.poNumber.localeCompare(a.poNumber));

  const filtered = sidebarOrders.filter(({ poNumber, vendor }) =>
    matchesAllTokens([poNumber, vendor.name, vendor.company, vendor.phone, vendor.email], tokens),
  );

  // Centre the current purchase order on first mount only: the sidebar lives in the (editor)
  // layout and survives switches, so later scrolling belongs to the user.
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
    <Sidebar backHref="/purchase-orders" backLabel="All purchase orders">
      <div ref={rootRef}>
        <Command shouldFilter={false} className="bg-card border shadow-sm">
          <CommandInput
            placeholder="Search purchase orders..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>No purchase orders found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((order) => {
                  const isActive = order.id === activePurchaseOrderId;
                  // Second line: whichever vendor details matched the search, like the vendor picker.
                  const matchedDetails = [
                    order.vendor.name,
                    order.vendor.company,
                    order.vendor.phone,
                    order.vendor.email,
                  ].filter((field) => field.trim() !== "" && fieldMatchesAnyToken(field, tokens));

                  return (
                    <CommandItem
                      key={order.id}
                      value={order.id}
                      data-checked={isActive}
                      onSelect={() => router.push(`/purchase-orders/${order.id}/edit`)}
                      // The shared look replaces cmdk's filled hover bar and check icon: the
                      // current purchase order keeps its fill, other rows only brighten their text.
                      className={cn(
                        sidebarItemClass(isActive),
                        "data-selected:text-foreground *:[svg]:hidden",
                        isActive ? "data-selected:bg-muted" : "data-selected:bg-transparent",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate tabular-nums">
                          <Highlight text={order.poNumber} tokens={tokens} />
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
      </div>
    </Sidebar>
  );
}
