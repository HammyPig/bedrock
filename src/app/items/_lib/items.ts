import { type SavedItem } from "~/lib/items";

export interface ItemErrors {
  sku?: "required";
  name?: "required";
}

/** Null when the item is valid; SKU uniqueness is enforced by the server on save. */
export function validateItem(item: SavedItem): ItemErrors | null {
  const errors: ItemErrors = {};
  if (item.sku.trim() === "") errors.sku = "required";
  if (item.name.trim() === "") errors.name = "required";
  return (errors.sku ?? errors.name) ? errors : null;
}
