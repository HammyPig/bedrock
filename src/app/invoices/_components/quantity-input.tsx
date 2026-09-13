"use client";

import { MILLI_PER_UNIT, quantityMilliSchema } from "../_lib/money";
import { NumberInput } from "./number-input";

type QuantityInputProps = Omit<
  React.ComponentProps<typeof NumberInput>,
  "value" | "onValueChange" | "scale" | "schema"
> & {
  quantityMilli: number;
  onQuantityMilliChange: (quantityMilli: number) => void;
};

/**
 * Unit-facing wrapper over NumberInput, the way MoneyInput is cents-facing: it
 * shows 2.5 and commits 2500, so no caller has to know the stored unit.
 */
export function QuantityInput({
  quantityMilli,
  onQuantityMilliChange,
  ...props
}: QuantityInputProps) {
  return (
    <NumberInput
      value={quantityMilli}
      scale={MILLI_PER_UNIT}
      schema={quantityMilliSchema}
      onValueChange={onQuantityMilliChange}
      {...props}
    />
  );
}
