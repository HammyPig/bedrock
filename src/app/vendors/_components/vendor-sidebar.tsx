"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { vendorDisplayName } from "~/app/purchase-orders/_lib/purchase-order";
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
import { matchesAllTokens, tokenize } from "~/lib/search";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/** Floating switcher beside the edit form: every saved vendor, searchable by name or company. */
export function VendorSidebar() {
  const { vendorId: activeVendorId } = useParams<{ vendorId: string }>();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  // Same order as the vendors list, so switching feels consistent.
  const [vendors] = api.vendor.list.useSuspenseQuery();
  const filtered = vendors.filter(({ name, company }) => matchesAllTokens([name, company], tokens));

  // Centre the current vendor on first mount only: the sidebar lives in the (editor)
  // layout and survives vendor switches, so later scrolling belongs to the user.
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
    <Sidebar backHref="/vendors" backLabel="All vendors">
      <div ref={rootRef}>
        <Command shouldFilter={false} className="bg-card border shadow-sm">
          <CommandInput placeholder="Search vendors..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>No vendors found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((vendor) => {
                  const isActive = vendor.id === activeVendorId;

                  return (
                    <CommandItem
                      key={vendor.id}
                      value={vendor.id}
                      data-checked={isActive}
                      onSelect={() => router.push(`/vendors/${vendor.id}/edit`)}
                      // The shared look replaces cmdk's filled hover bar and check icon: the
                      // current vendor keeps its fill, other rows only brighten their text.
                      className={cn(
                        sidebarItemClass(isActive),
                        "data-selected:text-foreground *:[svg]:hidden",
                        isActive ? "data-selected:bg-muted" : "data-selected:bg-transparent",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">
                          <Highlight text={vendorDisplayName(vendor)} tokens={tokens} />
                        </span>
                        {/* The display name already shows the company when the name is empty. */}
                        {vendor.name.trim() !== "" && vendor.company.trim() !== "" && (
                          <span className="text-muted-foreground truncate text-xs">
                            <Highlight text={vendor.company} tokens={tokens} />
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
