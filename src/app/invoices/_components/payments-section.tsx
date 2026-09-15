"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";

import { MoneyInput } from "~/components/money-input";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatIsoDate, todayIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { PAYMENT_METHOD_OPTIONS } from "../_lib/invoice";
import { type Payment, type PaymentMethod } from "../_lib/types";

interface PaymentsSectionProps {
  isQuote: boolean;
  payments: Payment[];
  /** Recorded and deleted payments wait, with the invoice's other changes, for its save. */
  onPaymentsChange: (payments: Payment[]) => void;
  /** Prefills the amount input; paying off the full balance is the common case. */
  balanceCents: number;
}

/** The recorded payments between the totals and the balance due, with record/delete controls. */
export function PaymentsSection({
  isQuote,
  payments,
  onPaymentsChange,
  balanceCents,
}: PaymentsSectionProps) {
  const [adding, setAdding] = useState(false);
  const [amountCents, setAmountCents] = useState(0);
  const [paidDate, setPaidDate] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("card");

  const startPartial = () => {
    setAmountCents(0);
    setPaidDate(todayIsoDate());
    setMethod("card");
    setAdding(true);
  };

  const record = (payment: Omit<Payment, "id">) => {
    // In the order a saved invoice lists them, so rows don't shuffle on reload.
    const added = [...payments, { ...payment, id: crypto.randomUUID() }];
    onPaymentsChange(added.sort((a, b) => a.paidDate.localeCompare(b.paidDate)));
    setAdding(false);
  };

  const recordFull = () => {
    if (balanceCents <= 0) return;
    record({ amountCents: balanceCents, paidDate: todayIsoDate(), method: "card" });
  };

  const recordPartial = () => {
    if (amountCents <= 0 || paidDate === "") return;
    record({ amountCents, paidDate, method });
  };

  return (
    <div className="space-y-2.5">
      {payments.map((payment) => (
        <div key={payment.id} className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-sm">
              Paid {formatIsoDate(payment.paidDate)} ·{" "}
              {PAYMENT_METHOD_OPTIONS.find((option) => option.value === payment.method)?.label}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete payment"
              onClick={() => onPaymentsChange(payments.filter(({ id }) => id !== payment.id))}
            >
              <XIcon />
            </Button>
          </div>
          <span className="text-sm tabular-nums">-{formatCents(payment.amountCents)}</span>
        </div>
      ))}

      {/* Quotes aren't payable, and a settled invoice has nothing left to record. */}
      {!isQuote &&
        balanceCents > 0 &&
        (adding ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                className="h-7 w-34 px-1.5 text-sm"
                aria-label="Payment date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.currentTarget.value)}
              />
              <MoneyInput
                className="h-7 w-24 px-1.5 text-sm"
                aria-label="Payment amount"
                valueCents={amountCents}
                onValueCentsChange={setAmountCents}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                <SelectTrigger size="sm" className="w-34 pl-1.5" aria-label="Payment method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  className="h-7"
                  disabled={amountCents <= 0 || paidDate === ""}
                  onClick={recordPartial}
                >
                  Record
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Cancel payment"
                  onClick={() => setAdding(false)}
                >
                  <XIcon />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button variant="link" size="sm" className="h-auto p-0" onClick={recordFull}>
              Record full payment
            </Button>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={startPartial}>
              Record partial payment
            </Button>
          </div>
        ))}
    </div>
  );
}
