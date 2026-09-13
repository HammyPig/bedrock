"use client";

import { Input } from "~/components/ui/input";
import { useAmountInput } from "~/components/use-amount-input";
import { CENTS_PER_DOLLAR, centsSchema, formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";

type MoneyInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "onFocus" | "onBlur" | "type"
> & {
  valueCents: number;
  onValueCentsChange: (cents: number) => void;
  /** Render the unfocused value as a bare "12.00" instead of "$12.00". */
  plain?: boolean;
};

/** Shows raw text while focused, commits cents on blur, renders formatted currency otherwise. */
export function MoneyInput({
  valueCents,
  onValueCentsChange,
  plain,
  className,
  ...props
}: MoneyInputProps) {
  const field = useAmountInput({
    value: valueCents,
    editText: (valueCents / 100).toFixed(2),
    scale: CENTS_PER_DOLLAR,
    schema: centsSchema,
    label: props["aria-label"],
    onCommit: onValueCentsChange,
  });

  return (
    <Input
      inputMode="decimal"
      className={cn("text-right tabular-nums", className)}
      value={field.text ?? (plain ? (valueCents / 100).toFixed(2) : formatCents(valueCents))}
      onFocus={field.onFocus}
      onChange={field.onChange}
      onBlur={field.onBlur}
      {...props}
      aria-invalid={field.invalid || props["aria-invalid"]}
    />
  );
}
