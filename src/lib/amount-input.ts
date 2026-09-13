import { type z } from "zod";

// An optional minus, then digits with at most one decimal point — and at least one digit.
const NUMBER_PATTERN = /^(-?)(?=\.?\d)(\d*)(?:\.(\d*))?$/;

/** Scales are powers of ten: 100 to the unit is two decimal places. */
function decimalPlaces(scale: number): number {
  return String(scale).length - 1;
}

/**
 * Typed text as a count of the stored unit: "12.5" at 100 to the unit is 1250.
 * The point is moved in the text rather than by multiplying, which would make
 * 0.29 dollars 28.999… cents; digits past the unit's precision are left as a
 * fraction for the schema's int() rule to refuse. Blank reads as 0, and null
 * means the text isn't a number at all.
 */
function toUnits(text: string, scale: number): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  const match = NUMBER_PATTERN.exec(cleaned);
  if (!match) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  const places = decimalPlaces(scale);
  return Number(
    `${sign}${whole}${fraction.slice(0, places).padEnd(places, "0")}.${fraction.slice(places)}`,
  );
}

/**
 * Holds typed text to the schema the server validates the stored value with,
 * so an input and the server agree on what's allowed. A refusal is worded in
 * the units that were typed, not the ones stored.
 */
export function parseAmountInput(
  text: string,
  scale: number,
  schema: z.ZodNumber,
): { value: number } | { error: string } {
  const units = toUnits(text, scale);
  if (units === null) return { error: "Enter a number." };

  const result = schema.safeParse(units);
  if (result.success) return { value: result.data };

  const [issue] = result.error.issues;
  switch (issue?.code) {
    // The only type a number can fail is int(), which refuses a fraction of the unit.
    case "invalid_type":
      return { error: `Use at most ${decimalPlaces(scale)} decimal places.` };
    case "too_small":
      return {
        error: `${issue.inclusive ? "Can't be less than" : "Must be more than"} ${Number(issue.minimum) / scale}.`,
      };
    case "too_big":
      return {
        error: `${issue.inclusive ? "Can't be more than" : "Must be less than"} ${Number(issue.maximum) / scale}.`,
      };
    default:
      return { error: issue?.message ?? "Enter a valid amount." };
  }
}

/**
 * The forgiving read, for an input with nowhere to show a refusal: rounded to
 * the unit and capped at the schema's maximum. Null when there is no sensible
 * number to take, so the input keeps what it had.
 */
export function roundAmountInput(text: string, scale: number, schema: z.ZodNumber): number | null {
  const units = toUnits(text, scale);
  if (units === null || units < 0) return null;
  return Math.min(Math.round(units), schema.maxValue ?? Infinity);
}
