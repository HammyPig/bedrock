"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";

import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { todayIsoDate } from "~/lib/dates";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import {
  billToMatchesCustomer,
  customerDisplayName,
  DOCUMENT_TYPE_OPTIONS,
  emptyBillTo,
  makeLineItem,
  repriceLineItems,
  validateDraft,
} from "../_lib/invoice";
import { computeTotals, paymentsTotalCents } from "../_lib/money";
import { type InvoiceAction, type InvoiceDraft, type Payment } from "../_lib/types";
import { BillToSection } from "./bill-to-section";
import { InvoiceMeta } from "./invoice-meta";
import { LineItemsGrid } from "./line-items-grid";
import { StickyActionBar } from "./sticky-action-bar";
import { TotalsPanel } from "./totals-panel";

function createInitialDraft(invoiceNumber: string): InvoiceDraft {
  return {
    documentType: "invoice",
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
    case "startNewCustomer":
      return { ...draft, billTo: action.billTo, sourceCustomerId: null };
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
          action.fromTierId,
          action.toTierId,
        ),
      };
  }
}

interface InvoiceFormProps {
  /** Existing invoice being edited; omitted on the create page. */
  initialDraft?: InvoiceDraft;
  /** Database id of the invoice being edited; omitted on the create page. */
  invoiceId?: string;
  /** The saved invoice's recorded payments, until the client-side query takes over. */
  initialPayments?: Payment[];
  /** Next free invoice number, pre-filled on the create page. */
  suggestedInvoiceNumber?: string;
}

export function InvoiceForm({
  initialDraft,
  invoiceId,
  initialPayments,
  suggestedInvoiceNumber,
}: InvoiceFormProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [savedItems] = api.item.list.useSuspenseQuery();

  const [draft, rawDispatch] = useReducer(
    invoiceReducer,
    initialDraft,
    (existing) => existing ?? createInitialDraft(suggestedInvoiceNumber ?? "INV-0001"),
  );
  const [showErrors, setShowErrors] = useState(false);
  /**
   * Whether the customer's details were edited in place during this sitting. An
   * invoice reopened later still differs from the customer record — that is the
   * snapshot doing its job — and re-asking about a decision already made is how
   * people learn to dismiss the prompt without reading it.
   */
  const [billToTouched, setBillToTouched] = useState(false);
  /**
   * Whether the bill-to fields describe a customer who does not exist yet. They
   * are written on the way through the invoice's own save, so an invoice that is
   * abandoned half-filled leaves no customer behind.
   */
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ onSaved?: (id: string) => void } | null>(null);
  const [exporting, setExporting] = useState(false);
  // An existing invoice starts in sync with the database; any edit marks it dirty.
  const [saved, setSaved] = useState(initialDraft !== undefined);

  const sendEmail = api.invoice.sendEmail.useMutation();
  const resetSendEmail = sendEmail.reset;

  const tierId = draft.billTo.tierId;
  const dispatch = useCallback(
    (action: InvoiceAction) => {
      setSaved(false);
      // A stale "Sent to …" confirmation shouldn't outlive the edit it predates.
      resetSendEmail();
      if (action.type === "patchBillTo") setBillToTouched(true);
      if (action.type === "fillBillToFromCustomer") {
        setBillToTouched(false);
        setCreatingCustomer(false);
      }
      if (action.type === "startNewCustomer") {
        setBillToTouched(false);
        setCreatingCustomer(true);
      }
      rawDispatch(action);
      // Any action that lands on a different tier re-prices the lines already on
      // the invoice (only those still at the old tier's catalog price).
      const newTierId =
        action.type === "patchBillTo"
          ? action.patch.tierId
          : action.type === "fillBillToFromCustomer"
            ? action.customer.tierId
            : undefined;
      if (newTierId !== undefined && newTierId !== tierId) {
        rawDispatch({
          type: "repriceLineItems",
          savedItems,
          fromTierId: tierId,
          toTierId: newTierId,
        });
      }
    },
    [resetSendEmail, tierId, savedItems],
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

  const createCustomer = api.customer.create.useMutation();

  const saving = createInvoice.isPending || updateInvoice.isPending || createCustomer.isPending;
  const saveError = (createInvoice.error ?? updateInvoice.error ?? createCustomer.error)?.message;

  // Payments live outside the draft: recording one mutates immediately, and the
  // query refetch (via invalidation) is what updates this list.
  const invoiceQuery = api.invoice.get.useQuery(
    { id: invoiceId ?? "" },
    { enabled: invoiceId !== undefined },
  );
  const payments = invoiceQuery.data?.payments ?? initialPayments ?? [];
  const paidCents = paymentsTotalCents(payments);

  const totals = computeTotals(draft, paidCents);
  const errors = showErrors ? validateDraft(draft) : null;

  const customers = api.customer.list.useQuery().data ?? [];
  const updateCustomer = api.customer.update.useMutation();
  const billToCustomer = customers.find((customer) => customer.id === draft.sourceCustomerId);
  const customerDiverged =
    billToCustomer !== undefined && !billToMatchesCustomer(draft.billTo, billToCustomer);
  // Named the way the picker lists them, so it is unambiguous which record is
  // about to change when two customers share a contact name.
  const billToLabel = (() => {
    if (billToCustomer === undefined) return "";
    const display = customerDisplayName(billToCustomer);
    const company = billToCustomer.company.trim();
    return company === "" || company === display ? display : `${display} · ${company}`;
  })();

  const commit = (toSave: InvoiceDraft, onSaved?: (id: string) => void) => {
    setShowErrors(false);
    if (invoiceId) {
      updateInvoice.mutate(
        { id: invoiceId, draft: toSave },
        { onSuccess: ({ id }) => onSaved?.(id) },
      );
    } else {
      createInvoice.mutate(toSave, { onSuccess: ({ id }) => onSaved?.(id) });
    }
  };

  /**
   * A customer typed straight into the invoice gets their record here, and the
   * invoice is billed to it. Validation has already run, so they are guaranteed
   * an identity to be found by again.
   */
  const save = (onSaved?: (id: string) => void) => {
    if (!creatingCustomer) {
      commit(draft, onSaved);
      return;
    }
    createCustomer.mutate(draft.billTo, {
      onSuccess: ({ id }) => {
        setCreatingCustomer(false);
        // Not a user edit, so it must not mark the invoice unsaved again.
        rawDispatch({ type: "patch", patch: { sourceCustomerId: id } });
        void utils.customer.list.invalidate();
        commit({ ...draft, sourceCustomerId: id }, onSaved);
      },
    });
  };

  const persist = (onSaved?: (id: string) => void) => {
    if (saving) return;
    if (validateDraft(draft)) {
      setShowErrors(true);
      return;
    }
    // The edit menu in the bill-to section is easy to walk past while looking at
    // line items. Saving is the moment they are demonstrably finished with the
    // invoice, so it is the last honest place to ask where the change belongs.
    if (billToTouched && customerDiverged) {
      setPendingSave({ onSaved });
      return;
    }
    save(onSaved);
  };

  const resolveBillToDivergence = (updateRecord: boolean) => {
    const pending = pendingSave;
    setPendingSave(null);
    setBillToTouched(false);
    if (updateRecord && billToCustomer !== undefined) {
      updateCustomer.mutate(
        { id: billToCustomer.id, details: draft.billTo },
        { onSuccess: () => void utils.customer.list.invalidate() },
      );
    }
    save(pending?.onSaved);
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
      const blob = await invoicePdfBlob(draft, settings, paidCents);
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
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {initialDraft
            ? `Edit ${initialDraft.invoiceNumber}`
            : draft.documentType === "quote"
              ? "New quote"
              : "New invoice"}
        </h1>
        <div
          className="flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Document type"
        >
          {DOCUMENT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "px-3 py-1.5 text-sm",
                draft.documentType === option.value
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => dispatch({ type: "patch", patch: { documentType: option.value } })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-8 p-8 sm:p-10">
          <BillToSection
            billTo={draft.billTo}
            sourceCustomerId={draft.sourceCustomerId}
            creating={creatingCustomer}
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
            tierId={draft.billTo.tierId}
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
                placeholder={`Notes to appear on the ${draft.documentType}...`}
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
              invoiceId={invoiceId}
              documentType={draft.documentType}
              payments={payments}
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

      <Dialog
        open={pendingSave !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSave(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update customer?</DialogTitle>
            <DialogDescription>
              This invoice has different details for {billToLabel}. Save them to that customer as
              well, or keep the change on this invoice only?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => resolveBillToDivergence(false)}>
              Just this invoice
            </Button>
            <Button onClick={() => resolveBillToDivergence(true)}>Update customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
