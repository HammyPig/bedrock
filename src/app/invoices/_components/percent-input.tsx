"use client";

import { BASIS_POINTS_PER_PERCENT, basisPointsSchema } from "../_lib/money";
import { NumberInput } from "./number-input";

type PercentInputProps = Omit<
  React.ComponentProps<typeof NumberInput>,
  "value" | "onValueChange" | "scale" | "schema"
> & {
  basisPoints: number;
  onBasisPointsChange: (basisPoints: number) => void;
};

/**
 * Percent-facing wrapper over NumberInput, the way MoneyInput is cents-facing:
 * it shows 10 and commits 1000, so no caller has to know the stored unit.
 */
export function PercentInput({ basisPoints, onBasisPointsChange, ...props }: PercentInputProps) {
  return (
    <NumberInput
      value={basisPoints}
      scale={BASIS_POINTS_PER_PERCENT}
      schema={basisPointsSchema}
      onValueChange={onBasisPointsChange}
      {...props}
    />
  );
}
