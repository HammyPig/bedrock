"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";

import { BackLink } from "~/components/back-link";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { todayIsoDate } from "~/lib/dates";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { emptyBillTo, makeLineItem, repriceLineItems, validateDraft } from "../_lib/invoice";
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
    case "repriceLineItems":
      return {
        ...draft,
        lineItems: repriceLineItems(
          draft.lineItems,
          action.savedItems,
          action.fromTier,
          action.toTier,
        ),
      };
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
  const [exporting, setExporting] = useState(false);
  // An existing invoice starts in sync with the database; any edit marks it dirty.
  const [saved, setSaved] = useState(initialDraft !== undefined);

  const sendEmail = api.invoice.sendEmail.useMutation();
  const resetSendEmail = sendEmail.reset;

  const tier = draft.billTo.tier;
  const dispatch = useCallback(
    (action: InvoiceAction) => {
      setSaved(false);
      // A stale "Sent to …" confirmation shouldn't outlive the edit it predates.
      resetSendEmail();
      rawDispatch(action);
      // Any action that lands on a different tier re-prices the lines already on
      // the invoice (only those still at the old tier's catalog price).
      const newTier =
        action.type === "patchBillTo"
          ? action.patch.tier
          : action.type === "fillBillToFromCustomer"
            ? action.customer.tier
            : undefined;
      if (newTier !== undefined && newTier !== tier) {
        rawDispatch({ type: "repriceLineItems", savedItems, fromTier: tier, toTier: newTier });
      }
    },
    [resetSendEmail, tier, savedItems],
  );

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

  const persist = (onSaved?: (id: string) => void) => {
    if (saving) return;
    if (validateDraft(draft)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (invoiceId) {
      updateInvoice.mutate({ id: invoiceId, draft }, { onSuccess: ({ id }) => onSaved?.(id) });
    } else {
      createInvoice.mutate(draft, { onSuccess: ({ id }) => onSaved?.(id) });
    }
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // The PDF renderer is heavy, so it only loads when an export is requested.
      const [{ invoicePdfBlob }, settings] = await Promise.all([
        import("../_lib/invoice-pdf"),
        utils.settings.get.ensureData(),
      ]);
      const blob = await invoicePdfBlob(draft, settings);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${draft.invoiceNumber.trim() || "invoice"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* On the edit page the (editor) sidebar already shows this link at xl and up. */}
      <div className={cn("mb-4", initialDraft && "xl:hidden")}>
        <BackLink href="/invoices">All invoices</BackLink>
      </div>
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
            tier={draft.billTo.tier}
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
          exporting={exporting}
          sending={sendEmail.isPending}
          sendError={sendEmail.error?.message}
          sentTo={sendEmail.data?.sentTo}
          onSave={() => persist()}
          onSaveAndExport={() => persist(() => void handleExportPdf())}
          onSaveAndEmail={() => persist((id) => sendEmail.mutate({ id }))}
        />
      </div>
    </div>
  );
}
