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
