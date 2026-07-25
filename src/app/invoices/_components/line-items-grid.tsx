"use client";

import { useEffect, useRef, useState } from "react";
import { GripVerticalIcon, PackageIcon, PercentIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { tierUnitPriceCents, type SavedItem } from "~/lib/items";
import { formatCents, parseMoneyInput } from "~/lib/money";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import { makeLineItem, normalizeSku } from "../_lib/invoice";
import { lineItemSubtotalCents } from "../_lib/money";
import { type InvoiceAction, type LineItem, type Tier } from "../_lib/types";
import { Highlight } from "~/components/highlight";
import { NumberInput } from "./number-input";

type CellField = "sku" | "name" | "quantity" | "unitPrice" | "discount";

/** The name cell is a textarea; every other cell is an input. */
type CellElement = HTMLInputElement | HTMLTextAreaElement;

// Inline style rather than a Tailwind arbitrary value: the optional columns
// would need one full class string per combination for the JIT to see them.
function gridTemplateColumns(showDiscount: boolean, showBackorder: boolean) {
  return [
    "1.25rem", // drag handle
    "5.5rem", // SKU
    "minmax(0,1fr)", // name
    "3rem", // qty
    "5.5rem", // unit price
    ...(showDiscount ? ["3rem"] : []),
    "5.5rem", // subtotal
    ...(showBackorder ? ["4.5rem"] : []),
    "2rem", // remove
  ].join(" ");
}

interface LineItemsGridProps {
  items: LineItem[];
  savedItems: SavedItem[];
  /** The invoice's customer tier, which decides the price a picked catalog item comes in at. */
  tierId: string | null;
  invalidItemIds: string[];
  error?: string;
  dispatch: (action: InvoiceAction) => void;
}

export function LineItemsGrid({
  items,
  savedItems,
  tierId,
  invalidItemIds,
  error,
  dispatch,
}: LineItemsGridProps) {
  // Names for the unit-price dropdown; harmlessly empty while Tiered pricing is off.
  const tiersQuery = api.tier.list.useQuery();
  const tiers = tiersQuery.data ?? [];
  const cellRefs = useRef(new Map<string, CellElement>());
  const [pendingFocus, setPendingFocus] = useState<{ id: string; field: CellField } | null>(null);
  // Discount and backorder columns are opt-in; each starts visible when the
  // invoice already uses it so saved data can never be hidden.
  const [discountToggle, setDiscountToggle] = useState(() =>
    items.some((item) => item.discountPercent > 0),
  );
  const [backorderToggle, setBackorderToggle] = useState(() =>
    items.some((item) => item.backordered),
  );
  const hasDiscounts = items.some((item) => item.discountPercent > 0);
  const hasBackorders = items.some((item) => item.backordered);
  const showDiscount = discountToggle || hasDiscounts;
  const showBackorder = backorderToggle || hasBackorders;
  const gridStyle = { gridTemplateColumns: gridTemplateColumns(showDiscount, showBackorder) };

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

    const lastField: CellField = showDiscount ? "discount" : "unitPrice";
    if (e.key === "Tab" && !e.shiftKey && field === lastField && isLastRow) {
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
      patch: {
        sku: saved.sku,
        name: saved.name,
        unitPriceCents: tierUnitPriceCents(saved, tierId),
      },
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
        className="text-muted-foreground grid items-center gap-2 px-0.5 text-xs font-medium"
        style={gridStyle}
        aria-hidden
      >
        <span />
        <span>SKU</span>
        <span>Name</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        {showDiscount && <span className="text-right">Disc. %</span>}
        <span className="text-right">Subtotal</span>
        {showBackorder && <span className="text-center">Backorder</span>}
        <span />
      </div>
      <div className="space-y-2">
        {items.map((item, index) => {
          const showInvalid = invalidItemIds.includes(item.id);
          const patchItem = (patch: Partial<Omit<LineItem, "id">>) =>
            dispatch({ type: "updateLineItem", id: item.id, patch });

          return (
            <div key={item.id} className="grid items-center gap-2" style={gridStyle}>
              {/* TODO: drag-to-reorder (later enhancement) */}
              <GripVerticalIcon aria-hidden className="text-muted-foreground/40 size-4" />
              <ItemLookupCell
                field="sku"
                item={item}
                index={index}
                savedItems={savedItems}
                tierId={tierId}
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
                tierId={tierId}
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
              <UnitPriceCell
                item={item}
                index={index}
                savedItems={savedItems}
                tiers={tiers}
                cellRef={registerCell(item.id, "unitPrice")}
                onPatch={patchItem}
                onKeyDown={(e) => handleCellKeyDown(e, item.id, "unitPrice")}
              />
              {showDiscount && (
                <NumberInput
                  ref={registerCell(item.id, "discount")}
                  className="px-1.5"
                  max={100}
                  value={item.discountPercent}
                  aria-label={`Line ${index + 1} discount percent`}
                  onValueChange={(discountPercent) => patchItem({ discountPercent })}
                  onKeyDown={(e) => handleCellKeyDown(e, item.id, "discount")}
                />
              )}
              <div className="text-muted-foreground text-right text-sm tabular-nums">
                {formatCents(lineItemSubtotalCents(item))}
              </div>
              {showBackorder && (
                <Checkbox
                  className="justify-self-center"
                  checked={item.backordered}
                  aria-label={`Line ${index + 1} backordered`}
                  onCheckedChange={(checked) => patchItem({ backordered: checked === true })}
                />
              )}
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
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="-ml-1" onClick={() => appendRow("sku")}>
          <PlusIcon />
          Add item
        </Button>
        <div className="-mr-1 flex items-center gap-1">
          <ColumnToggle
            icon={<PercentIcon />}
            label="Discounts"
            show={showDiscount}
            locked={hasDiscounts}
            onToggle={() => setDiscountToggle(!showDiscount)}
          />
          <ColumnToggle
            icon={<PackageIcon />}
            label="Backorders"
            show={showBackorder}
            locked={hasBackorders}
            onToggle={() => setBackorderToggle(!showBackorder)}
          />
        </div>
      </div>
    </section>
  );
}

/** Chip that reveals an opt-in grid column; locked while lines still use it. */
function ColumnToggle({
  icon,
  label,
  show,
  locked,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  show: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant={show ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={show}
      disabled={locked}
      onClick={onToggle}
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * Unit price cell: edits as free text like MoneyInput, plus a dropdown of the
 * matched catalog item's prices — unit price and each tier's — to hand-pick
 * from regardless of the invoice's tier. Not built on MoneyInput because a
 * pick must land inside the editing session; MoneyInput would overwrite it
 * when its own text committed on blur.
 */
function UnitPriceCell({
  item,
  index,
  savedItems,
  tiers,
  cellRef,
  onPatch,
  onKeyDown,
}: {
  item: LineItem;
  index: number;
  savedItems: SavedItem[];
  tiers: Tier[];
  cellRef: (el: CellElement | null) => void;
  onPatch: (patch: Partial<Omit<LineItem, "id">>) => void;
  onKeyDown: (e: React.KeyboardEvent<CellElement>) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const saved =
    item.sku.trim() === ""
      ? undefined
      : savedItems.find((s) => normalizeSku(s.sku) === normalizeSku(item.sku));
  // Only offer a pick list when the item actually has tier prices; a bare
  // "Unit price" entry would just be noise.
  const options =
    saved && Object.keys(saved.tierPrices).length > 0
      ? [
          { id: "unit", label: "Unit price", cents: saved.unitPriceCents },
          ...tiers.flatMap((tier) => {
            const cents = saved.tierPrices[tier.id] ?? 0;
            return cents > 0 ? [{ id: tier.id, label: tier.name, cents }] : [];
          }),
        ]
      : [];

  const handlePick = (cents: number) => {
    onPatch({ unitPriceCents: cents });
    // Replace the in-progress text so the later blur commits the same amount.
    setText((cents / 100).toFixed(2));
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        ref={cellRef}
        inputMode="decimal"
        className="text-right tabular-nums"
        value={text ?? formatCents(item.unitPriceCents)}
        aria-label={`Line ${index + 1} unit price`}
        onFocus={(e) => {
          setText(item.unitPriceCents === 0 ? "" : (item.unitPriceCents / 100).toFixed(2));
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          if (text !== null) {
            const parsed = parseMoneyInput(text);
            if (parsed !== null) onPatch({ unitPriceCents: parsed });
          }
          setText(null);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <div className="bg-popover ring-foreground/10 absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg p-1 shadow-md ring-1">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="hover:bg-muted flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                handlePick(option.cents);
              }}
            >
              <span className="truncate">{option.label}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatCents(option.cents)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** SKU / name cell with a catalog lookup: typing searches SKU, name, and barcode. */
function ItemLookupCell({
  field,
  item,
  index,
  savedItems,
  tierId,
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
  tierId: string | null;
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
                {formatCents(tierUnitPriceCents(saved, tierId))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
