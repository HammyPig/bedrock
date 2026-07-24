import { type CustomerTier } from "~/app/invoices/_lib/types";

export interface SavedItem {
  sku: string;
  name: string;
  vendor: string;
  barcode: string;
  unitPriceCents: number;
  tier1PriceCents: number;
  tier2PriceCents: number;
  tier3PriceCents: number;
  costCents: number;
}

const TIER_PRICE_FIELD = {
  tier_1: "tier1PriceCents",
  tier_2: "tier2PriceCents",
  tier_3: "tier3PriceCents",
} as const satisfies Record<CustomerTier, keyof SavedItem>;

/** Price for a customer tier; untiered customers and unset ($0) tier prices get the unit price. */
export function tierUnitPriceCents(item: SavedItem, tier: CustomerTier | ""): number {
  const tierPrice = tier === "" ? 0 : item[TIER_PRICE_FIELD[tier]];
  return tierPrice > 0 ? tierPrice : item.unitPriceCents;
}
