export interface SavedItem {
  sku: string;
  name: string;
  vendor: string;
  barcode: string;
  unitPriceCents: number;
  /** Tier prices by tier id (Tiered pricing module); a missing or $0 entry falls back to unitPriceCents. */
  tierPrices: Record<string, number>;
  costCents: number;
}

/** Price for a customer tier; untiered customers and unset tier prices get the unit price. */
export function tierUnitPriceCents(item: SavedItem, tierId: string | null): number {
  const tierPrice = tierId === null ? 0 : (item.tierPrices[tierId] ?? 0);
  return tierPrice > 0 ? tierPrice : item.unitPriceCents;
}

/** Equal when every tier prices to the same amount, treating missing and $0 alike. */
export function tierPricesEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const tierIds = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...tierIds].every((tierId) => (a[tierId] ?? 0) === (b[tierId] ?? 0));
}
