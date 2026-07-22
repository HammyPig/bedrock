"use client";

import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { formatCents } from "../_lib/money";
import { type Discount, type DiscountMode, type InvoiceAction, type Totals } from "../_lib/types";
import { MoneyInput } from "./money-input";
import { NumberInput } from "./number-input";

interface TotalsPanelProps {
  totals: Totals;
  discount: Discount | null;
  freightCents: number;
  taxRatePercent: number;
  paidCents: number;
  dispatch: (action: InvoiceAction) => void;
}

export function TotalsPanel({
  totals,
  discount,
  freightCents,
  taxRatePercent,
  paidCents,
  dispatch,
}: TotalsPanelProps) {
  const setDiscountMode = (mode: DiscountMode) => {
    if (discount?.mode !== mode) {
      dispatch({ type: "patch", patch: { discount: { mode, value: 0 } } });
    }
  };

  return (
    <div className="ml-auto w-full max-w-sm space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">Subtotal</span>
        <span className="text-sm tabular-nums">{formatCents(totals.subtotalCents)}</span>
      </div>

      {discount === null ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() =>
            dispatch({ type: "patch", patch: { discount: { mode: "percent", value: 0 } } })
          }
        >
          Add discount
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-sm">Discount</span>
            <div className="flex overflow-hidden rounded-md border">
              {(["percent", "fixed"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "px-1.5 py-0.5 text-xs",
                    discount.mode === mode
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                  onClick={() => setDiscountMode(mode)}
                >
                  {mode === "percent" ? "%" : "$"}
                </button>
              ))}
            </div>
            {discount.mode === "percent" ? (
              <NumberInput
                className="h-7 w-14 px-1.5 text-sm"
                aria-label="Discount percent"
                max={100}
                value={discount.value}
                onValueChange={(value) =>
                  dispatch({ type: "patch", patch: { discount: { mode: "percent", value } } })
                }
              />
            ) : (
              <MoneyInput
                plain
                className="h-7 w-20 px-1.5 text-sm"
                aria-label="Discount amount"
                valueCents={discount.value}
                onValueCentsChange={(value) =>
                  dispatch({ type: "patch", patch: { discount: { mode: "fixed", value } } })
                }
              />
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Remove discount"
              onClick={() => dispatch({ type: "patch", patch: { discount: null } })}
            >
              <XIcon />
            </Button>
          </div>
          <span className="text-sm tabular-nums">-{formatCents(totals.discountCents)}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label htmlFor="freight" className="text-muted-foreground text-sm">
          Freight
        </label>
        <MoneyInput
          id="freight"
          className="h-7 w-24 px-1.5 text-sm"
          valueCents={freightCents}
          onValueCentsChange={(cents) =>
            dispatch({ type: "patch", patch: { freightCents: cents } })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor="tax-rate" className="text-muted-foreground text-sm">
            GST
          </label>
          <NumberInput
            id="tax-rate"
            className="h-7 w-14 px-1.5 text-sm"
            value={taxRatePercent}
            onValueChange={(value) => dispatch({ type: "patch", patch: { taxRatePercent: value } })}
          />
          <span className="text-muted-foreground text-sm">%</span>
        </div>
        <span className="text-sm tabular-nums">{formatCents(totals.taxCents)}</span>
      </div>

      <div className="flex items-center justify-between border-t pt-2.5">
        <span className="text-sm font-medium">Total</span>
        <span className="text-sm font-medium tabular-nums">{formatCents(totals.totalCents)}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label htmlFor="paid" className="text-muted-foreground text-sm">
          Paid
        </label>
        <MoneyInput
          id="paid"
          className="h-7 w-24 px-1.5 text-sm"
          valueCents={paidCents}
          onValueCentsChange={(cents) => dispatch({ type: "patch", patch: { paidCents: cents } })}
        />
      </div>

      <div className="border-t pt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Balance due</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCents(totals.balanceCents)}
          </span>
        </div>
      </div>
    </div>
  );
}
