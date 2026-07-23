"use client";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatIsoDate } from "~/lib/dates";
import { deriveDueDate, PAYMENT_TERMS_OPTIONS } from "../_lib/invoice";
import { type InvoiceAction, type InvoiceDraft, type PaymentTerms } from "../_lib/types";

interface InvoiceMetaProps {
  draft: InvoiceDraft;
  invoiceNumberError?: string;
  dispatch: (action: InvoiceAction) => void;
}

export function InvoiceMeta({ draft, invoiceNumberError, dispatch }: InvoiceMetaProps) {
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="invoice-number">Invoice no.</Label>
        <Input
          id="invoice-number"
          value={draft.invoiceNumber}
          aria-invalid={invoiceNumberError !== undefined}
          onChange={(e) =>
            dispatch({ type: "patch", patch: { invoiceNumber: e.currentTarget.value } })
          }
        />
        {invoiceNumberError && <p className="text-destructive text-sm">{invoiceNumberError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="issue-date">Issue date</Label>
        <Input
          id="issue-date"
          type="date"
          value={draft.issueDate}
          onChange={(e) => dispatch({ type: "patch", patch: { issueDate: e.currentTarget.value } })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payment-terms">Terms</Label>
        <Select
          value={draft.terms}
          onValueChange={(value) =>
            dispatch({ type: "patch", patch: { terms: value as PaymentTerms } })
          }
        >
          <SelectTrigger id="payment-terms" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_TERMS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="due-date">Due date</Label>
        {draft.terms === "custom" ? (
          <Input
            id="due-date"
            type="date"
            value={draft.customDueDate ?? ""}
            onChange={(e) =>
              dispatch({ type: "patch", patch: { customDueDate: e.currentTarget.value } })
            }
          />
        ) : (
          <p className="text-muted-foreground flex h-8 items-center text-sm">
            {formatIsoDate(deriveDueDate(draft.issueDate, draft.terms))}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="po-number">P.O. #</Label>
        <Input
          id="po-number"
          value={draft.poNumber}
          onChange={(e) => dispatch({ type: "patch", patch: { poNumber: e.currentTarget.value } })}
        />
      </div>
    </section>
  );
}
