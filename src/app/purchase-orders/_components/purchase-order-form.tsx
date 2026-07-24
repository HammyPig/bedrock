"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";

import { makeLineItem } from "~/app/invoices/_lib/invoice";
import { BackLink } from "~/components/back-link";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { todayIsoDate } from "~/lib/dates";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { emptyVendorDetails, purchaseOrderTotals, validateDraft } from "../_lib/purchase-order";
import { type PurchaseOrderAction, type PurchaseOrderDraft } from "../_lib/types";
import { LineItemsGrid } from "./line-items-grid";
import { PurchaseOrderMeta } from "./purchase-order-meta";
import { StickyActionBar } from "./sticky-action-bar";
import { TotalsPanel } from "./totals-panel";
import { VendorSection } from "./vendor-section";

function createInitialDraft(poNumber: string): PurchaseOrderDraft {
  return {
    poNumber,
    vendor: emptyVendorDetails(),
    sourceVendorId: null,
    orderDate: todayIsoDate(),
    expectedDate: null,
    lineItems: [makeLineItem()],
    discount: null,
    freightCents: 0,
    taxRatePercent: 10,
    notes: "",
  };
}

function purchaseOrderReducer(
  draft: PurchaseOrderDraft,
  action: PurchaseOrderAction,
): PurchaseOrderDraft {
  switch (action.type) {
    case "patch":
      return { ...draft, ...action.patch };
    case "patchVendor":
      return { ...draft, vendor: { ...draft.vendor, ...action.patch } };
    case "fillVendorFromSaved": {
      const { id, ...vendor } = action.vendor;
      return { ...draft, vendor, sourceVendorId: id };
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

interface PurchaseOrderFormProps {
  /** Existing purchase order being edited; omitted on the create page. */
  initialDraft?: PurchaseOrderDraft;
  /** Database id of the purchase order being edited; omitted on the create page. */
  purchaseOrderId?: string;
  /** Next free purchase order number, pre-filled on the create page. */
  suggestedPoNumber?: string;
}

export function PurchaseOrderForm({
  initialDraft,
  purchaseOrderId,
  suggestedPoNumber,
}: PurchaseOrderFormProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [savedItems] = api.item.list.useSuspenseQuery();

  const [draft, rawDispatch] = useReducer(
    purchaseOrderReducer,
    initialDraft,
    (existing) => existing ?? createInitialDraft(suggestedPoNumber ?? "PO-0001"),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [exporting, setExporting] = useState(false);
  // An existing purchase order starts in sync with the database; any edit marks it dirty.
  const [saved, setSaved] = useState(initialDraft !== undefined);

  const sendEmail = api.purchaseOrder.sendEmail.useMutation();
  const resetSendEmail = sendEmail.reset;

  const dispatch = useCallback(
    (action: PurchaseOrderAction) => {
      setSaved(false);
      // A stale "Sent to …" confirmation shouldn't outlive the edit it predates.
      resetSendEmail();
      rawDispatch(action);
    },
    [resetSendEmail],
  );

  const createPurchaseOrder = api.purchaseOrder.create.useMutation({
    onSuccess: async ({ id }) => {
      setSaved(true);
      await utils.purchaseOrder.invalidate();
      router.push(`/purchase-orders/${id}/edit`);
    },
  });
  const updatePurchaseOrder = api.purchaseOrder.update.useMutation({
    onSuccess: async () => {
      setSaved(true);
      await utils.purchaseOrder.invalidate();
    },
  });

  const saving = createPurchaseOrder.isPending || updatePurchaseOrder.isPending;
  const saveError = (createPurchaseOrder.error ?? updatePurchaseOrder.error)?.message;

  const totals = purchaseOrderTotals(draft);
  const errors = showErrors ? validateDraft(draft) : null;

  const persist = (onSaved?: (id: string) => void) => {
    if (saving) return;
    if (validateDraft(draft)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (purchaseOrderId) {
      updatePurchaseOrder.mutate(
        { id: purchaseOrderId, draft },
        { onSuccess: ({ id }) => onSaved?.(id) },
      );
    } else {
      createPurchaseOrder.mutate(draft, { onSuccess: ({ id }) => onSaved?.(id) });
    }
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // The PDF renderer is heavy, so it only loads when an export is requested.
      const [{ purchaseOrderPdfBlob }, settings] = await Promise.all([
        import("../_lib/purchase-order-pdf"),
        utils.settings.get.ensureData(),
      ]);
      const blob = await purchaseOrderPdfBlob(draft, settings);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${draft.poNumber.trim() || "purchase-order"}.pdf`;
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
        <BackLink href="/purchase-orders">All purchase orders</BackLink>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {initialDraft ? `Edit ${initialDraft.poNumber}` : "New purchase order"}
      </h1>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-8 p-8 sm:p-10">
          <VendorSection
            vendor={draft.vendor}
            sourceVendorId={draft.sourceVendorId}
            error={errors?.vendor}
            dispatch={dispatch}
          />
          <PurchaseOrderMeta draft={draft} poNumberError={errors?.poNumber} dispatch={dispatch} />
          <LineItemsGrid
            items={draft.lineItems}
            savedItems={savedItems}
            invalidItemIds={errors?.invalidLineItemIds ?? []}
            error={errors?.lineItems}
            dispatch={dispatch}
          />
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
            <section className="flex-1 space-y-2">
              <Label htmlFor="po-notes">Notes</Label>
              <Textarea
                id="po-notes"
                rows={4}
                placeholder="Notes to appear on the purchase order..."
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
              dispatch={dispatch}
            />
          </div>
        </div>
        <StickyActionBar
          totalCents={totals.totalCents}
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
