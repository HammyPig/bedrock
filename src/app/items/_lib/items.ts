import { type SavedItem } from "~/lib/items";
import { type ItemRow, type ItemRowErrors, type ItemsChanges, type ItemsErrors } from "./types";

export function makeItemRow(seed?: SavedItem): ItemRow {
  return { id: crypto.randomUUID(), sku: "", name: "", unitPriceCents: 0, ...seed };
}

/** Comparison key only — the user's own casing/spacing is never rewritten. */
function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

export function validateItems(rows: ItemRow[]): ItemsErrors {
  const skuCounts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeSku(row.sku);
    if (key === "") continue;
    skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
  }

  const errors: ItemsErrors = new Map();
  for (const row of rows) {
    const rowErrors: ItemRowErrors = {};
    const key = normalizeSku(row.sku);
    if (key === "") {
      rowErrors.sku = "required";
    } else if ((skuCounts.get(key) ?? 0) > 1) {
      rowErrors.sku = "duplicate";
    }
    if (row.name.trim() === "") {
      rowErrors.name = "required";
    }
    if (rowErrors.sku ?? rowErrors.name) errors.set(row.id, rowErrors);
  }
  return errors;
}

export interface ItemsDiff {
  changes: ItemsChanges;
  editedCount: number;
  addedCount: number;
  deletedCount: number;
}

/** Compares the working rows against the last-saved snapshot. */
export function diffRows(rows: ItemRow[], savedRows: ItemRow[]): ItemsDiff {
  const savedById = new Map(savedRows.map((row) => [row.id, row]));
  const changes: ItemsChanges = new Map();
  let editedCount = 0;
  let addedCount = 0;

  for (const row of rows) {
    const saved = savedById.get(row.id);
    if (!saved) {
      changes.set(row.id, { isNew: true, sku: true, name: true, unitPriceCents: true });
      addedCount += 1;
      continue;
    }
    const rowChanges = {
      isNew: false,
      sku: row.sku !== saved.sku,
      name: row.name !== saved.name,
      unitPriceCents: row.unitPriceCents !== saved.unitPriceCents,
    };
    if (rowChanges.sku || rowChanges.name || rowChanges.unitPriceCents) {
      changes.set(row.id, rowChanges);
      editedCount += 1;
    }
  }

  const liveIds = new Set(rows.map((row) => row.id));
  const deletedCount = savedRows.filter((row) => !liveIds.has(row.id)).length;

  return { changes, editedCount, addedCount, deletedCount };
}

export function summarizeErrors(errors: ItemsErrors): string[] {
  const rowErrors = [...errors.values()];
  const messages: string[] = [];
  if (rowErrors.some((e) => e.sku === "duplicate")) {
    messages.push("Fix duplicate SKUs — each item needs a unique SKU.");
  }
  if (rowErrors.some((e) => e.sku === "required" || e.name === "required")) {
    messages.push("Every item needs a SKU and a name.");
  }
  return messages;
}
