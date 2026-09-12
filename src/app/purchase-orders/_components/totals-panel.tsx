"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";

import { NumberInput } from "~/app/invoices/_components/number-input";
import { type Discount, type DiscountMode, type Totals } from "~/app/invoices/_lib/types";
import { MoneyInput } from "~/components/money-input";
import { Button } from "~/components/ui/button";
import { formatCents } from "~/lib/money";
import { discountMode } from "~/app/invoices/_lib/money";
import { cn } from "~/lib/utils";
import { type PurchaseOrderAction } from "../_lib/types";

interface TotalsPanelProps {
  totals: Totals;
  discount: Discount | null;
  deliveryCents: number;
  /** The rate the document is written at — shown, never edited. */
  taxPercent: number;
  dispatch: (action: PurchaseOrderAction) => void;
}

export function TotalsPanel({
  totals,
  discount,
  deliveryCents,
  taxPercent,
  dispatch,
}: TotalsPanelProps) {
  /**
   * Which input the discount is being typed into. Local because a zeroed
   * discount reads as fixed either way — the stored data can only tell you the
   * mode once a number has been entered, and that is too late to render.
   */
  const [mode, setMode] = useState<DiscountMode>(() =>
    discount === null ? "percent" : discountMode(discount),
  );

  const switchMode = (next: DiscountMode) => {
    if (next === mode) return;
    setMode(next);
    dispatch({ type: "patch", patch: { discount: { percent: 0, amountCents: 0 } } });
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
          onClick={() => {
            setMode("percent");
            dispatch({ type: "patch", patch: { discount: { percent: 0, amountCents: 0 } } });
          }}
        >
          Add discount
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-sm">Discount</span>
            <div className="flex overflow-hidden rounded-md border">
              {(["percent", "fixed"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cn(
                    "px-1.5 py-0.5 text-xs",
                    option === mode
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                  onClick={() => switchMode(option)}
                >
                  {option === "percent" ? "%" : "$"}
                </button>
              ))}
            </div>
            {mode === "percent" ? (
              <NumberInput
                className="h-7 w-14 px-1.5 text-sm"
                aria-label="Discount percent"
                max={100}
                value={discount.percent}
                onValueChange={(percent) =>
                  dispatch({ type: "patch", patch: { discount: { ...discount, percent } } })
                }
              />
            ) : (
              <MoneyInput
                plain
                className="h-7 w-20 px-1.5 text-sm"
                aria-label="Discount amount"
                valueCents={discount.amountCents}
                onValueCentsChange={(amountCents) =>
                  dispatch({ type: "patch", patch: { discount: { percent: 0, amountCents } } })
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
        <label htmlFor="delivery-cents" className="text-muted-foreground text-sm">
          Delivery
        </label>
        <MoneyInput
          id="delivery-cents"
          className="h-7 w-24 px-1.5 text-sm"
          valueCents={deliveryCents}
          onValueCentsChange={(cents) =>
            dispatch({ type: "patch", patch: { deliveryCents: cents } })
          }
        />
      </div>

      {taxPercent > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-sm">GST ({taxPercent}%)</span>
          <span className="text-sm tabular-nums">{formatCents(totals.taxCents)}</span>
        </div>
      )}

      <div className="border-t pt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCents(totals.totalCents)}
          </span>
        </div>
      </div>
    </div>
  );
}
