"use client";

import { type z } from "zod";

import { Input } from "~/components/ui/input";
import { useAmountInput } from "~/components/use-amount-input";
import { cn } from "~/lib/utils";

type NumberInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "onFocus" | "onBlur" | "type"
> & {
  /** The committed value, as a count of the stored unit. */
  value: number;
  onValueChange: (value: number) => void;
  /** Stored units per typed unit: 1000 thousandths to a quantity of 1. */
  scale: number;
  /** The rule the stored value is held to — the same one the server validates with. */
  schema: z.ZodNumber;
};

/** Shows raw text while focused, commits on blur, renders the plain number otherwise. */
export function NumberInput({
  value,
  onValueChange,
  scale,
  schema,
  className,
  ...props
}: NumberInputProps) {
  const field = useAmountInput({
    value,
    editText: String(value / scale),
    scale,
    schema,
    label: props["aria-label"],
    onCommit: onValueChange,
  });

  return (
    <Input
      inputMode="decimal"
      className={cn("text-right tabular-nums", className)}
      value={field.text ?? String(value / scale)}
      onFocus={field.onFocus}
      onChange={field.onChange}
      onBlur={field.onBlur}
      {...props}
      aria-invalid={field.invalid || props["aria-invalid"]}
    />
  );
}
