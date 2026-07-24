"use client";

import { useEffect, useRef, useState } from "react";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { MoneyInput } from "~/components/money-input";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { tierUnitPriceCents, type SavedItem } from "~/lib/items";
import { formatCents } from "~/lib/money";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { cn } from "~/lib/utils";
import { makeLineItem } from "../_lib/invoice";
import { lineItemSubtotalCents } from "../_lib/money";
import { type CustomerTier, type InvoiceAction, type LineItem } from "../_lib/types";
import { Highlight } from "~/components/highlight";
import { NumberInput } from "./number-input";

type CellField = "sku" | "name" | "quantity" | "unitPrice" | "discount";

/** The name cell is a textarea; every other cell is an input. */
type CellElement = HTMLInputElement | HTMLTextAreaElement;

const GRID_COLS =
  "grid grid-cols-[1.25rem_5.5rem_minmax(0,1fr)_3rem_5.5rem_3rem_5.5rem_2rem] items-center gap-2";

interface LineItemsGridProps {
  items: LineItem[];
  savedItems: SavedItem[];
  /** The invoice's customer tier, which decides the price a picked catalog item comes in at. */
  tier: CustomerTier | "";
  invalidItemIds: string[];
  error?: string;
  dispatch: (action: InvoiceAction) => void;
}

export function LineItemsGrid({
  items,
  savedItems,
  tier,
  invalidItemIds,
  error,
  dispatch,
}: LineItemsGridProps) {
  const cellRefs = useRef(new Map<string, CellElement>());
  const [pendingFocus, setPendingFocus] = useState<{ id: string; field: CellField } | null>(null);

  // Focus lands after the newly appended row has committed and registered its refs.
  useEffect(() => {
    if (!pendingFocus) return;
    const el = cellRefs.current.get(`${pendingFocus.id}:${pendingFocus.field}`);
    if (el) {
      el.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, items]);

  const registerCell = (id: string, field: CellField) => (el: CellElement | null) => {
    const key = `${id}:${field}`;
    if (el) {
      cellRefs.current.set(key, el);
    } else {
      cellRefs.current.delete(key);
    }
  };

  const appendRow = (focusField: CellField) => {
    const item = makeLineItem();
    dispatch({ type: "appendLineItem", item });
    setPendingFocus({ id: item.id, field: focusField });
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<CellElement>, id: string, field: CellField) => {
    const index = items.findIndex((item) => item.id === id);
    const isLastRow = index === items.length - 1;

    if (e.key === "Tab" && !e.shiftKey && field === "discount" && isLastRow) {
      e.preventDefault();
      appendRow("sku");
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (isLastRow) {
        appendRow(field);
      } else {
        const next = items[index + 1];
        if (next) cellRefs.current.get(`${next.id}:${field}`)?.focus();
      }
    }
  };

  const handlePickSaved = (id: string, saved: SavedItem) => {
    dispatch({
      type: "updateLineItem",
      id,
      patch: { sku: saved.sku, name: saved.name, unitPriceCents: tierUnitPriceCents(saved, tier) },
    });
  };

  const handleRemove = (id: string) => {
    const index = items.findIndex((item) => item.id === id);
    dispatch({ type: "removeLineItem", id });
    const neighbor = items[index - 1] ?? items[index + 1];
    if (neighbor) setPendingFocus({ id: neighbor.id, field: "sku" });
  };

  return (
    <section className="space-y-2">
      <div
        className={cn(GRID_COLS, "px-0.5 text-xs font-medium text-muted-foreground")}
        aria-hidden
      >
        <span />
        <span>SKU</span>
        <span>Name</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span className="text-right">Disc. %</span>
        <span className="text-right">Subtotal</span>
        <span />
      </div>
      <div className="space-y-2">
        {items.map((item, index) => {
          const showInvalid = invalidItemIds.includes(item.id);
          const patchItem = (patch: Partial<Omit<LineItem, "id">>) =>
            dispatch({ type: "updateLineItem", id: item.id, patch });

          return (
            <div key={item.id} className={GRID_COLS}>
              {/* TODO: drag-to-reorder (later enhancement) */}
              <GripVerticalIcon aria-hidden className="text-muted-foreground/40 size-4" />
              <ItemLookupCell
                field="sku"
                item={item}
                index={index}
                savedItems={savedItems}
                tier={tier}
                cellRef={registerCell(item.id, "sku")}
                onPatch={patchItem}
                onPickSaved={(saved) => handlePickSaved(item.id, saved)}
                onKeyDown={(e) => handleCellKeyDown(e, item.id, "sku")}
              />
              <ItemLookupCell
                field="name"
                item={item}
                index={index}
                savedItems={savedItems}
                tier={tier}
                invalid={showInvalid && item.name.trim() === ""}
                cellRef={registerCell(item.id, "name")}
                onPatch={patchItem}
                onPickSaved={(saved) => handlePickSaved(item.id, saved)}
                onKeyDown={(e) => handleCellKeyDown(e, item.id, "name")}
              />
              <NumberInput
                ref={registerCell(item.id, "quantity")}
                className="px-1.5"
                value={item.quantity}
                aria-label={`Line ${index + 1} quantity`}
                aria-invalid={showInvalid && item.quantity <= 0}
                onValueChange={(quantity) => patchItem({ quantity })}
                onKeyDown={(e) => handleCellKeyDown(e, item.id, "quantity")}
              />
              <MoneyInput
                ref={registerCell(item.id, "unitPrice")}
                valueCents={item.unitPriceCents}
                aria-label={`Line ${index + 1} unit price`}
                onValueCentsChange={(cents) => patchItem({ unitPriceCents: cents })}
                onKeyDown={(e) => handleCellKeyDown(e, item.id, "unitPrice")}
              />
              <NumberInput
                ref={registerCell(item.id, "discount")}
                className="px-1.5"
                max={100}
                value={item.discountPercent}
                aria-label={`Line ${index + 1} discount percent`}
                onValueChange={(discountPercent) => patchItem({ discountPercent })}
                onKeyDown={(e) => handleCellKeyDown(e, item.id, "discount")}
              />
              <div className="text-muted-foreground text-right text-sm tabular-nums">
                {formatCents(lineItemSubtotalCents(item))}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={items.length === 1}
                aria-label={`Remove line ${index + 1}`}
                onClick={() => handleRemove(item.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          );
        })}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button variant="ghost" size="sm" className="-ml-1" onClick={() => appendRow("sku")}>
        <PlusIcon />
        Add item
      </Button>
    </section>
  );
}

/** SKU / name cell with a catalog lookup: typing searches SKU, name, and barcode. */
function ItemLookupCell({
  field,
  item,
  index,
  savedItems,
  tier,
  invalid = false,
  cellRef,
  onPatch,
  onPickSaved,
  onKeyDown,
}: {
  field: "sku" | "name";
  item: LineItem;
  index: number;
  savedItems: SavedItem[];
  tier: CustomerTier | "";
  invalid?: boolean;
  cellRef: (el: CellElement | null) => void;
  onPatch: (patch: Partial<Omit<LineItem, "id">>) => void;
  onPickSaved: (saved: SavedItem) => void;
  onKeyDown: (e: React.KeyboardEvent<CellElement>) => void;
}) {
  const [open, setOpen] = useState(false);

  const text = field === "sku" ? item.sku : item.name;
  const tokens = tokenize(text);
  const suggestions =
    open && text.trim().length >= 1
      ? savedItems
          .filter((saved) => matchesAllTokens([saved.sku, saved.name, saved.barcode], tokens))
          .slice(0, 6)
      : [];

  const sharedProps = {
    value: text,
    placeholder: field === "sku" ? "SKU" : "Item name",
    "aria-label": `Line ${index + 1} ${field === "sku" ? "SKU" : "name"}`,
    "aria-invalid": invalid,
    onBlur: () => setOpen(false),
  };

  return (
    <div className="relative">
      {field === "sku" ? (
        <Input
          {...sharedProps}
          ref={cellRef}
          className="px-1.5"
          onChange={(e) => {
            onPatch({ sku: e.currentTarget.value });
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      ) : (
        // Item names run long; an auto-growing textarea wraps instead of
        // truncating, so the row gains a line rather than hiding text.
        <Textarea
          {...sharedProps}
          ref={cellRef}
          rows={1}
          className="min-h-8 resize-none py-[5px] leading-5"
          onChange={(e) => {
            onPatch({ name: e.currentTarget.value.replace(/\s*\n\s*/g, " ") });
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      )}
      {suggestions.length > 0 && (
        <div className="bg-popover ring-foreground/10 absolute left-0 z-10 mt-1 w-96 overflow-hidden rounded-lg p-1 shadow-md ring-1">
          {suggestions.map((saved) => (
            <button
              key={saved.sku}
              type="button"
              className="hover:bg-muted flex w-full items-start justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                onPickSaved(saved);
                setOpen(false);
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span>
                  <Highlight text={saved.sku} tokens={tokens} />
                </span>
                <span className="text-muted-foreground text-xs">
                  <Highlight text={saved.name} tokens={tokens} />
                </span>
              </span>
              {/* The price this invoice's customer tier would actually pay. */}
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatCents(tierUnitPriceCents(saved, tier))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
