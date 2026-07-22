"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { emptyBillTo, makeLineItem, todayIsoDate, validateDraft } from "../_lib/invoice";
import { mockSavedItems, SUGGESTED_INVOICE_NUMBER } from "../_lib/mock-data";
import { computeTotals } from "../_lib/money";
import { type InvoiceAction, type InvoiceDraft } from "../_lib/types";
import { BillToSection } from "./bill-to-section";
import { InvoiceMeta } from "./invoice-meta";
import { LineItemsGrid } from "./line-items-grid";
import { StickyActionBar } from "./sticky-action-bar";
import { TotalsPanel } from "./totals-panel";

function createInitialDraft(): InvoiceDraft {
  return {
    invoiceNumber: SUGGESTED_INVOICE_NUMBER,
    billTo: emptyBillTo(),
    sourceCustomerId: null,
    delivery: false,
    deliverySameAsBilling: true,
    poNumber: "",
    issueDate: todayIsoDate(),
    terms: "net_30",
    customDueDate: null,
    lineItems: [makeLineItem()],
    discount: null,
    freightCents: 0,
    taxRatePercent: 10,
    paidCents: 0,
    notes: "",
  };
}

function invoiceReducer(draft: InvoiceDraft, action: InvoiceAction): InvoiceDraft {
  switch (action.type) {
    case "patch":
      return { ...draft, ...action.patch };
    case "patchBillTo":
      return { ...draft, billTo: { ...draft.billTo, ...action.patch } };
    case "fillBillToFromCustomer": {
      const { id, ...billTo } = action.customer;
      return { ...draft, billTo, sourceCustomerId: id };
    }
    case "updateLineItem":
      return {
        ...draft,
        lineItems: draft.lineItems.map((item) =>
          item.id === action.id ? { ...item, ...action.patch } : item,
        ),
      };
    case "appendLineItem":
      return { ...draft, lineItems: [...draft.lineItems, action.item] };
    case "removeLineItem":
      return { ...draft, lineItems: draft.lineItems.filter((item) => item.id !== action.id) };
  }
}

/**
 * Cosmetic autosave: cycles "saving" -> "saved" on draft edits (debounced).
 * Nothing is persisted in this scaffold.
 */
function useAutosave(draft: InvoiceDraft) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRun = useRef(true);

  const saveNow = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus("saving");
    timeoutRef.current = setTimeout(() => setStatus("saved"), 800);
  }, []);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    saveNow();
  }, [draft, saveNow]);

  return { status, saveNow };
}

export function InvoiceForm() {
  const [draft, dispatch] = useReducer(invoiceReducer, null, createInitialDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const { status: autosaveStatus, saveNow } = useAutosave(draft);
  const totals = computeTotals(draft);
  const errors = showErrors ? validateDraft(draft) : null;

  useEffect(() => {
    if (!justSent) return;
    const timeout = setTimeout(() => setJustSent(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSent]);

  const handleSend = () => {
    if (validateDraft(draft)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setJustSent(true);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New invoice</h1>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-8 p-8 sm:p-10">
          <BillToSection
            billTo={draft.billTo}
            sourceCustomerId={draft.sourceCustomerId}
            delivery={draft.delivery}
            deliverySameAsBilling={draft.deliverySameAsBilling}
            error={errors?.billTo}
            dispatch={dispatch}
          />
          <InvoiceMeta
            draft={draft}
            invoiceNumberError={errors?.invoiceNumber}
            dispatch={dispatch}
          />
          <LineItemsGrid
            items={draft.lineItems}
            savedItems={mockSavedItems}
            invalidItemIds={errors?.invalidLineItemIds ?? []}
            error={errors?.lineItems}
            dispatch={dispatch}
          />
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
            <section className="flex-1 space-y-2">
              <Label htmlFor="invoice-notes">Notes</Label>
              <Textarea
                id="invoice-notes"
                rows={4}
                placeholder="Notes to appear on the invoice..."
                value={draft.notes}
                onChange={(e) =>
                  dispatch({ type: "patch", patch: { notes: e.currentTarget.value } })
                }
              />
            </section>
            <TotalsPanel
              totals={totals}
              discount={draft.discount}
              freightCents={draft.freightCents}
              taxRatePercent={draft.taxRatePercent}
              paidCents={draft.paidCents}
              dispatch={dispatch}
            />
          </div>
        </div>
        <StickyActionBar
          balanceCents={totals.balanceCents}
          autosaveStatus={autosaveStatus}
          justSent={justSent}
          onSaveDraft={saveNow}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
