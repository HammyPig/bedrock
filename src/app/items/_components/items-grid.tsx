"use client";

import { useEffect, useRef, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { MoneyInput } from "~/components/money-input";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { makeItemRow } from "../_lib/items";
import { type ItemRow, type ItemsErrors } from "../_lib/types";

type CellField = "sku" | "name" | "unitPrice";

/** The name cell is a textarea; every other cell is an input. */
type CellElement = HTMLInputElement | HTMLTextAreaElement;

const GRID_COLS = "grid grid-cols-[6.5rem_minmax(0,1fr)_6.5rem_2rem] items-center gap-2";

interface ItemsGridProps {
  /** Rows currently visible (already filtered), in display order. */
  rows: ItemRow[];
  /** Unfiltered catalog size, to tell "no items yet" from "nothing matches". */
  totalCount: number;
  errors: ItemsErrors;
  messages: string[];
  onUpdate: (id: string, patch: Partial<Omit<ItemRow, "id">>) => void;
  onAppend: (row: ItemRow) => void;
  onRemove: (id: string) => void;
  onRowFocus: (id: string) => void;
  onRowBlur: (id: string) => void;
}

export function ItemsGrid({
  rows,
  totalCount,
  errors,
  messages,
  onUpdate,
  onAppend,
  onRemove,
  onRowFocus,
  onRowBlur,
}: ItemsGridProps) {
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
  }, [pendingFocus, rows]);

  const registerCell = (id: string, field: CellField) => (el: CellElement | null) => {
    const key = `${id}:${field}`;
    if (el) {
      cellRefs.current.set(key, el);
    } else {
      cellRefs.current.delete(key);
    }
  };

  const appendRow = (focusField: CellField) => {
    const row = makeItemRow();
    onAppend(row);
    setPendingFocus({ id: row.id, field: focusField });
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<CellElement>, id: string, field: CellField) => {
    const index = rows.findIndex((row) => row.id === id);
    const isLastRow = index === rows.length - 1;

    if (e.key === "Tab" && !e.shiftKey && field === "unitPrice" && isLastRow) {
      e.preventDefault();
      appendRow("sku");
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (isLastRow) {
        appendRow(field);
      } else {
        const next = rows[index + 1];
        if (next) cellRefs.current.get(`${next.id}:${field}`)?.focus();
      }
    }
  };

  const handleRemove = (id: string) => {
    const index = rows.findIndex((row) => row.id === id);
    onRemove(id);
    const neighbor = rows[index - 1] ?? rows[index + 1];
    if (neighbor) setPendingFocus({ id: neighbor.id, field: "sku" });
  };

  const emptyMessage =
    totalCount === 0
      ? "No items yet. Add your first item."
      : rows.length === 0
        ? "No items match your search."
        : null;

  return (
    <section className="space-y-2">
      {emptyMessage ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{emptyMessage}</p>
      ) : (
        <>
          <div
            className={cn(GRID_COLS, "px-0.5 text-xs font-medium text-muted-foreground")}
            aria-hidden
          >
            <span>SKU</span>
            <span>Name</span>
            <span className="text-right">Unit price</span>
            <span />
          </div>
          <div className="space-y-2">
            {rows.map((row, index) => {
              const rowErrors = errors.get(row.id);

              return (
                <div
                  key={row.id}
                  className={GRID_COLS}
                  onFocus={() => onRowFocus(row.id)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) onRowBlur(row.id);
                  }}
                >
                  <Input
                    ref={registerCell(row.id, "sku")}
                    className="px-1.5"
                    value={row.sku}
                    placeholder="SKU"
                    aria-label={`Item ${index + 1} SKU`}
                    aria-invalid={Boolean(rowErrors?.sku)}
                    onChange={(e) => onUpdate(row.id, { sku: e.currentTarget.value })}
                    onKeyDown={(e) => handleCellKeyDown(e, row.id, "sku")}
                  />
                  {/* Item names run long; an auto-growing textarea wraps instead of
                      truncating, so the row gains a line rather than hiding text. */}
                  <Textarea
                    ref={registerCell(row.id, "name")}
                    rows={1}
                    className="min-h-8 resize-none py-[5px] leading-5"
                    value={row.name}
                    placeholder="Item name"
                    aria-label={`Item ${index + 1} name`}
                    aria-invalid={Boolean(rowErrors?.name)}
                    onChange={(e) =>
                      onUpdate(row.id, { name: e.currentTarget.value.replace(/\s*\n\s*/g, " ") })
                    }
                    onKeyDown={(e) => handleCellKeyDown(e, row.id, "name")}
                  />
                  <MoneyInput
                    ref={registerCell(row.id, "unitPrice")}
                    valueCents={row.unitPriceCents}
                    aria-label={`Item ${index + 1} unit price`}
                    onValueCentsChange={(unitPriceCents) => onUpdate(row.id, { unitPriceCents })}
                    onKeyDown={(e) => handleCellKeyDown(e, row.id, "unitPrice")}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => handleRemove(row.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {messages.map((message) => (
        <p key={message} className="text-destructive text-sm">
          {message}
        </p>
      ))}
      <Button variant="ghost" size="sm" className="-ml-1" onClick={() => appendRow("sku")}>
        <PlusIcon />
        Add item
      </Button>
    </section>
  );
}
