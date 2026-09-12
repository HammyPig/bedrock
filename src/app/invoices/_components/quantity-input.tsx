"use client";

import { MILLI_PER_UNIT } from "../_lib/money";
import { NumberInput } from "./number-input";

type QuantityInputProps = Omit<
  React.ComponentProps<typeof NumberInput>,
  "value" | "onValueChange"
> & {
  quantityMilli: number;
  onQuantityMilliChange: (quantityMilli: number) => void;
};

/**
 * Unit-facing wrapper over NumberInput, the way MoneyInput is cents-facing: it
 * shows 2.5 and commits 2500, so no caller has to know the stored unit. Typing
 * more than three decimals rounds to the nearest thousandth.
 */
export function QuantityInput({
  quantityMilli,
  onQuantityMilliChange,
  ...props
}: QuantityInputProps) {
  return (
    <NumberInput
      value={quantityMilli / MILLI_PER_UNIT}
      onValueChange={(quantity) => onQuantityMilliChange(Math.round(quantity * MILLI_PER_UNIT))}
      {...props}
    />
  );
}
