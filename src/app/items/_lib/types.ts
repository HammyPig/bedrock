import { type SavedItem } from "~/lib/items";

export interface ItemRow extends SavedItem {
  id: string;
}

export interface ItemRowErrors {
  sku?: "required" | "duplicate";
  name?: "required";
}

/** Keyed by row id; only rows with at least one problem have an entry. */
export type ItemsErrors = Map<string, ItemRowErrors>;

/** Which fields differ from the last-saved row; a new row counts every field. */
export interface ItemRowChanges {
  isNew: boolean;
  sku: boolean;
  name: boolean;
  unitPriceCents: boolean;
}

/** Keyed by row id; only added/edited rows have an entry. */
export type ItemsChanges = Map<string, ItemRowChanges>;
