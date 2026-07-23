"use client";

import { useState } from "react";

import { Input } from "~/components/ui/input";
import { formatCents, parseMoneyInput } from "~/lib/money";
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
  const [text, setText] = useState<string | null>(null);

  return (
    <Input
      inputMode="decimal"
      className={cn("text-right tabular-nums", className)}
      value={text ?? (plain ? (valueCents / 100).toFixed(2) : formatCents(valueCents))}
      onFocus={(e) => {
        setText(valueCents === 0 ? "" : (valueCents / 100).toFixed(2));
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        if (text !== null) {
          const parsed = parseMoneyInput(text);
          if (parsed !== null) onValueCentsChange(parsed);
        }
        setText(null);
      }}
      {...props}
    />
  );
}
