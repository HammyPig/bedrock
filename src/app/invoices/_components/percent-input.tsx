"use client";

import { BASIS_POINTS_PER_PERCENT, MAX_BASIS_POINTS } from "../_lib/money";
import { NumberInput } from "./number-input";

type PercentInputProps = Omit<
  React.ComponentProps<typeof NumberInput>,
  "value" | "onValueChange" | "max"
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
      value={basisPoints / BASIS_POINTS_PER_PERCENT}
      max={MAX_BASIS_POINTS / BASIS_POINTS_PER_PERCENT}
      onValueChange={(percent) =>
        onBasisPointsChange(Math.round(percent * BASIS_POINTS_PER_PERCENT))
      }
      {...props}
    />
  );
}
