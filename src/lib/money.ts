import { z } from "zod";

const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export const CENTS_PER_DOLLAR = 100;

/**
 * Every stored amount of money: whole cents, never negative. The routers
 * validate with it and money inputs check typed text against it, so the form
 * can't accept an amount the server would refuse.
 */
export const centsSchema = z.number().int().min(0);

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
