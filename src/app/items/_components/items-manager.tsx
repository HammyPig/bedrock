"use client";

import { useEffect, useState } from "react";

import { Input } from "~/components/ui/input";
import { mockSavedItems } from "~/lib/items";
import { matchesAllTokens, tokenize } from "~/lib/search";
import { diffRows, makeItemRow, summarizeErrors, validateItems } from "../_lib/items";
import { type ItemRow, type ItemsErrors } from "../_lib/types";
import { ItemsGrid } from "./items-grid";
import { SaveBar } from "./save-bar";

export function ItemsManager() {
  const [rows, setRows] = useState<ItemRow[]>(() =>
    mockSavedItems.map((item) => makeItemRow(item)),
  );
  /** Last-saved snapshot; nothing is persisted in this scaffold. */
  const [savedRows, setSavedRows] = useState<ItemRow[]>(rows);
  const [justSaved, setJustSaved] = useState(false);
  const [query, setQuery] = useState("");
  /** Rows that haven't been blurred yet — their validation errors stay hidden. */
  const [untouchedIds, setUntouchedIds] = useState<ReadonlySet<string>>(new Set());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  const tokens = tokenize(query);
  // A focused row stays visible even when an edit stops it matching the filter,
  // so it can't vanish mid-keystroke and drop focus.
  const visibleRows = rows.filter(
    (row) => matchesAllTokens([row.sku, row.name], tokens) || row.id === focusedRowId,
  );

  const errors = validateItems(rows);
  const shownErrors: ItemsErrors = new Map([...errors].filter(([id]) => !untouchedIds.has(id)));
  const messages = summarizeErrors(shownErrors);
  const { changes, editedCount, addedCount, deletedCount } = diffRows(rows, savedRows);

  const markTouched = (id: string) =>
    setUntouchedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const handleUpdate = (id: string, patch: Partial<Omit<ItemRow, "id">>) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const handleAppend = (row: ItemRow) => {
    // Clear any filter so the new row is visible and can take focus.
    setQuery("");
    setRows((prev) => [...prev, row]);
    setUntouchedIds((prev) => new Set(prev).add(row.id));
  };

  const handleRemove = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
    markTouched(id);
    setFocusedRowId((prev) => (prev === id ? null : prev));
  };

  const handleRowBlur = (id: string) => {
    markTouched(id);
    setFocusedRowId((prev) => (prev === id ? null : prev));
  };

  const handleSave = () => {
    // Surface errors on rows that were never blurred before blocking the save.
    setUntouchedIds(new Set());
    if (errors.size > 0) return;
    setSavedRows(rows);
    setJustSaved(true);
  };

  const countLabel =
    visibleRows.length === rows.length
      ? `${rows.length} item${rows.length === 1 ? "" : "s"}`
      : `${visibleRows.length} of ${rows.length} items`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Items</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        The products and services you add to invoices.
      </p>
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
          <ItemsGrid
            rows={visibleRows}
            totalCount={rows.length}
            errors={shownErrors}
            changes={changes}
            messages={messages}
            onUpdate={handleUpdate}
            onAppend={handleAppend}
            onRemove={handleRemove}
            onRowFocus={setFocusedRowId}
            onRowBlur={handleRowBlur}
          />
        </div>
        <SaveBar
          editedCount={editedCount}
          addedCount={addedCount}
          deletedCount={deletedCount}
          justSaved={justSaved}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
