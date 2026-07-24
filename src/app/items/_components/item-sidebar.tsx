"use client";

import { useEffect, useRef, useState } from "react";
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
import { matchesAllTokens, tokenize } from "~/lib/search";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/** Floating switcher beside the edit form: the whole catalog, searchable by SKU or name. */
export function ItemSidebar() {
  const { itemId: activeItemId } = useParams<{ itemId: string }>();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  // Same catalog order as the items list, so switching feels consistent.
  const [items] = api.item.list.useSuspenseQuery();
  const filtered = items.filter(({ sku, name }) => matchesAllTokens([sku, name], tokens));

  // Centre the current item on first mount only: the sidebar lives in the (editor)
  // layout and survives item switches, so later scrolling belongs to the user.
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
    <Sidebar backHref="/items" backLabel="All items">
      <div ref={rootRef}>
        <Command shouldFilter={false} className="bg-card border shadow-sm">
          <CommandInput placeholder="Search items..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>No items found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((item) => {
                  const isActive = item.id === activeItemId;

                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      data-checked={isActive}
                      onSelect={() => router.push(`/items/${item.id}/edit`)}
                      // The shared look replaces cmdk's filled hover bar and check icon: the
                      // current item keeps its fill, other rows only brighten their text.
                      className={cn(
                        sidebarItemClass(isActive),
                        "data-selected:text-foreground *:[svg]:hidden",
                        isActive ? "data-selected:bg-muted" : "data-selected:bg-transparent",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate tabular-nums">
                          <Highlight text={item.sku} tokens={tokens} />
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          <Highlight text={item.name} tokens={tokens} />
                        </span>
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
