"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";

import { customerDisplayName } from "~/app/invoices/_lib/invoice";
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

/** Floating switcher beside the edit form: every saved customer, searchable by name or company. */
export function CustomerSidebar() {
  const { customerId: activeCustomerId } = useParams<{ customerId: string }>();
  const router = useRouter();
  // Switching customers keeps you in the same mode: profile to profile, edit form to edit form.
  const editing = usePathname().endsWith("/edit");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  // Same order as the customers list, so switching feels consistent.
  const [customers] = api.customer.list.useSuspenseQuery();
  const filtered = customers.filter(({ name, company }) =>
    matchesAllTokens([name, company], tokens),
  );

  // Centre the current customer on first mount only: the sidebar lives in the (editor)
  // layout and survives customer switches, so later scrolling belongs to the user.
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
    <Sidebar backHref="/customers" backLabel="All customers">
      <div ref={rootRef}>
        <Command shouldFilter={false} className="bg-card border shadow-sm">
          <CommandInput placeholder="Search customers..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>No customers found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((customer) => {
                  const isActive = customer.id === activeCustomerId;

                  return (
                    <CommandItem
                      key={customer.id}
                      value={customer.id}
                      data-checked={isActive}
                      onSelect={() =>
                        router.push(`/customers/${customer.id}${editing ? "/edit" : ""}`)
                      }
                      // The shared look replaces cmdk's filled hover bar and check icon: the
                      // current customer keeps its fill, other rows only brighten their text.
                      className={cn(
                        sidebarItemClass(isActive),
                        "data-selected:text-foreground *:[svg]:hidden",
                        isActive ? "data-selected:bg-muted" : "data-selected:bg-transparent",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">
                          <Highlight text={customerDisplayName(customer)} tokens={tokens} />
                        </span>
                        {/* The display name already shows the company when the name is empty. */}
                        {customer.name.trim() !== "" && customer.company.trim() !== "" && (
                          <span className="text-muted-foreground truncate text-xs">
                            <Highlight text={customer.company} tokens={tokens} />
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
