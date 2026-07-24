"use client";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { type PurchaseOrderAction, type PurchaseOrderDraft } from "../_lib/types";

interface PurchaseOrderMetaProps {
  draft: PurchaseOrderDraft;
  poNumberError?: string;
  dispatch: (action: PurchaseOrderAction) => void;
}

export function PurchaseOrderMeta({ draft, poNumberError, dispatch }: PurchaseOrderMetaProps) {
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="po-number">P.O. no.</Label>
        <Input
          id="po-number"
          value={draft.poNumber}
          aria-invalid={poNumberError !== undefined}
          onChange={(e) => dispatch({ type: "patch", patch: { poNumber: e.currentTarget.value } })}
        />
        {poNumberError && <p className="text-destructive text-sm">{poNumberError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="order-date">Order date</Label>
        <Input
          id="order-date"
          type="date"
          value={draft.orderDate}
          onChange={(e) => dispatch({ type: "patch", patch: { orderDate: e.currentTarget.value } })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="expected-date">Expected delivery</Label>
        <Input
          id="expected-date"
          type="date"
          value={draft.expectedDate ?? ""}
          onChange={(e) =>
            dispatch({
              type: "patch",
              patch: { expectedDate: e.currentTarget.value === "" ? null : e.currentTarget.value },
            })
          }
        />
      </div>
    </section>
  );
}
