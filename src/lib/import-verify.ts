import { type SavedItem } from "~/lib/items";

/** Columns covered by the post-import database check, in display order. */
export const ITEM_HASH_COLUMNS = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "Name" },
  { key: "vendor", label: "Vendor" },
  { key: "barcode", label: "Barcode" },
  { key: "unitPriceCents", label: "Unit price" },
  { key: "tier1PriceCents", label: "Tier 1 price" },
  { key: "tier2PriceCents", label: "Tier 2 price" },
  { key: "tier3PriceCents", label: "Tier 3 price" },
  { key: "costCents", label: "Cost" },
] as const satisfies readonly { key: keyof SavedItem; label: string }[];

export type ItemHashKey = (typeof ITEM_HASH_COLUMNS)[number]["key"];
export type ItemColumnHashes = Record<ItemHashKey, string>;

/**
 * SHA-256 hex of one column: each row's value as a string, sorted, NUL-joined.
 * Runs on both client and server (Web Crypto) so the sort order and digest
 * are byte-identical on each side.
 */
export async function hashColumn(values: string[]): Promise<string> {
  const joined = [...values].sort().join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface ParsedHashBlock {
  /** Label → lowercase hex hash; a repeated label keeps its last line. */
  entries: { label: string; hash: string }[];
  /** 1-based numbers of non-empty lines that aren't "Label hash". */
  badLines: number[];
}

/** Parses a pasted block of "Label hash" lines, e.g. "Unit price 6a8f82…". */
export function parseHashBlock(text: string): ParsedHashBlock {
  const entries: ParsedHashBlock["entries"] = [];
  const badLines: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    const [, label, hash] = /^\s*(.*\S)\s+([0-9a-fA-F]{64})\s*$/.exec(line) ?? [];
    if (label && hash) entries.push({ label, hash: hash.toLowerCase() });
    else badLines.push(i + 1);
  });
  return { entries, badLines };
}

export async function hashItemColumns(rows: SavedItem[]): Promise<ItemColumnHashes> {
  const entries = await Promise.all(
    ITEM_HASH_COLUMNS.map(
      async ({ key }) => [key, await hashColumn(rows.map((row) => String(row[key])))] as const,
    ),
  );
  return Object.fromEntries(entries) as ItemColumnHashes;
}
