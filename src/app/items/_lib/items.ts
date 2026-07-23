import { type SavedItem } from "~/lib/items";
import { type ItemRow, type ItemRowErrors, type ItemsErrors } from "./types";

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
