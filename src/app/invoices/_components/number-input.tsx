"use client";

import { useState } from "react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

type NumberInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "onFocus" | "onBlur" | "type"
> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Clamps committed values to this upper bound (lower bound is always 0). */
  max?: number;
};

/** Shows raw text while focused, commits on blur, renders the plain number otherwise. */
export function NumberInput({ value, onValueChange, max, className, ...props }: NumberInputProps) {
  const [text, setText] = useState<string | null>(null);

  return (
    <Input
      inputMode="decimal"
      className={cn("text-right tabular-nums", className)}
      value={text ?? String(value)}
      onFocus={(e) => {
        setText(value === 0 ? "" : String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        if (text !== null) {
          const parsed = Number(text);
          if (Number.isFinite(parsed) && parsed >= 0) {
            onValueChange(max === undefined ? parsed : Math.min(max, parsed));
          }
        }
        setText(null);
      }}
      {...props}
    />
  );
}
