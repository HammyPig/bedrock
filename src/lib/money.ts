const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function formatCents(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

/** Parses free-text money input ("1,200", "$90.50") into cents; blank clears to 0. Null when invalid. */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
