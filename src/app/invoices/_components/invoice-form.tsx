"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";

import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { todayIsoDate } from "~/lib/dates";
import { api } from "~/trpc/react";
import { emptyBillTo, makeLineItem, validateDraft } from "../_lib/invoice";
import { computeTotals } from "../_lib/money";
import { type InvoiceAction, type InvoiceDraft } from "../_lib/types";
import { BillToSection } from "./bill-to-section";
import { InvoiceMeta } from "./invoice-meta";
import { LineItemsGrid } from "./line-items-grid";
import { StickyActionBar } from "./sticky-action-bar";
import { TotalsPanel } from "./totals-panel";

function createInitialDraft(invoiceNumber: string): InvoiceDraft {
  return {
    invoiceNumber,
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

interface InvoiceFormProps {
  /** Existing invoice being edited; omitted on the create page. */
  initialDraft?: InvoiceDraft;
  /** Database id of the invoice being edited; omitted on the create page. */
  invoiceId?: string;
  /** Next free invoice number, pre-filled on the create page. */
  suggestedInvoiceNumber?: string;
}

export function InvoiceForm({ initialDraft, invoiceId, suggestedInvoiceNumber }: InvoiceFormProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [savedItems] = api.item.list.useSuspenseQuery();

  const [draft, rawDispatch] = useReducer(
    invoiceReducer,
    initialDraft,
    (existing) => existing ?? createInitialDraft(suggestedInvoiceNumber ?? "INV-0001"),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [justSent, setJustSent] = useState(false);
  // An existing invoice starts in sync with the database; any edit marks it dirty.
  const [saved, setSaved] = useState(initialDraft !== undefined);

  const dispatch = useCallback((action: InvoiceAction) => {
    setSaved(false);
    rawDispatch(action);
  }, []);

  const createInvoice = api.invoice.create.useMutation({
    onSuccess: async ({ id }) => {
      setSaved(true);
      await utils.invoice.invalidate();
      router.push(`/invoices/${id}/edit`);
    },
  });
  const updateInvoice = api.invoice.update.useMutation({
    onSuccess: async () => {
      setSaved(true);
      await utils.invoice.invalidate();
    },
  });

  const saving = createInvoice.isPending || updateInvoice.isPending;
  const saveError = (createInvoice.error ?? updateInvoice.error)?.message;

  const totals = computeTotals(draft);
  const errors = showErrors ? validateDraft(draft) : null;

  useEffect(() => {
    if (!justSent) return;
    const timeout = setTimeout(() => setJustSent(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSent]);

  const persist = (onSaved?: () => void) => {
    if (saving) return;
    if (validateDraft(draft)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (invoiceId) {
      updateInvoice.mutate({ id: invoiceId, draft }, { onSuccess: onSaved });
    } else {
      createInvoice.mutate(draft, { onSuccess: onSaved });
    }
  };

  const handleSend = () => persist(() => setJustSent(true));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {initialDraft ? `Edit ${initialDraft.invoiceNumber}` : "New invoice"}
      </h1>
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
            savedItems={savedItems}
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
          autosaveStatus={saving ? "saving" : saved ? "saved" : "idle"}
          saveError={saveError}
          justSent={justSent}
          onSaveDraft={() => persist()}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
