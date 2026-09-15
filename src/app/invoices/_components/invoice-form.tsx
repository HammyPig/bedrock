"use client";

import { useCallback, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BackLink } from "~/components/back-link";
import { FieldErrorsContext, useFieldErrors } from "~/components/field-errors";
import { LeaveGuard } from "~/components/leave-guard";
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
  addressHasContent,
  customerDetailsMatchesCustomer,
  customerDisplayName,
  DOCUMENT_TYPE_OPTIONS,
  emptyCustomerDetails,
  lockingModules,
  makeLineItem,
  repriceLineItems,
  validateDraft,
} from "../_lib/invoice";
import {
  computeTotals,
  documentTaxBasisPoints,
  paymentsTotalCents,
  resolveDiscount,
} from "../_lib/money";
import { type InvoiceAction, type InvoiceDraft, type Payment } from "../_lib/types";
import { CustomerDetailsSection } from "./customer-details-section";
import { InvoiceMeta } from "./invoice-meta";
import { LineItemsGrid } from "./line-items-grid";
import { StickyActionBar } from "./sticky-action-bar";
import { TotalsPanel } from "./totals-panel";

function createInitialDraft(taxBasisPoints: number): InvoiceDraft {
  return {
    isQuote: false,
    // Assigned by the server on save, off the business's numbering counter.
    invoiceNumber: "",
    customerDetails: emptyCustomerDetails(),
    customerId: null,
    hasDeliveryAddress: false,
    deliverySameAsBilling: true,
    issueDate: todayIsoDate(),
    terms: "net_30",
    customDueDate: null,
    lineItems: [makeLineItem(taxBasisPoints)],
    discount: null,
    deliveryCents: 0,
    deliveryTaxBasisPoints: taxBasisPoints,
    notes: "",
  };
}

function applyAction(draft: InvoiceDraft, action: InvoiceAction): InvoiceDraft {
  switch (action.type) {
    case "patch":
      return { ...draft, ...action.patch };
    case "patchCustomerDetails":
      return { ...draft, customerDetails: { ...draft.customerDetails, ...action.patch } };
    case "fillDetailsFromCustomer": {
      const { id, ...customerDetails } = action.customer;
      // Refilling the same customer is "Reset to saved", which leaves the
      // invoice's delivery choice alone; a different customer starts it afresh.
      if (id === draft.customerId) return { ...draft, customerDetails };
      return {
        ...draft,
        customerDetails,
        customerId: id,
        hasDeliveryAddress: false,
        deliverySameAsBilling: !addressHasContent(customerDetails.deliveryAddress),
      };
    }
    case "startNewCustomer":
      return {
        ...draft,
        customerDetails: action.customerDetails,
        customerId: null,
        hasDeliveryAddress: false,
        deliverySameAsBilling: true,
      };
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
    case "moveLineItem": {
      const moved = draft.lineItems.find((item) => item.id === action.id);
      if (!moved) return draft;
      const lineItems = draft.lineItems.filter((item) => item.id !== action.id);
      lineItems.splice(action.to, 0, moved);
      return { ...draft, lineItems };
    }
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

/**
 * Every action re-settles the discount, so editing a line can never leave a
 * percent discount showing cents from the subtotal it had a moment ago, or a
 * fixed one larger than what is left to discount.
 */
function invoiceReducer(draft: InvoiceDraft, action: InvoiceAction): InvoiceDraft {
  const next = applyAction(draft, action);
  const discount = resolveDiscount(next.discount, next.lineItems);
  return discount === next.discount ? next : { ...next, discount };
}

/** Told the saved invoice's id and the number it ended up with. */
type SavedHandler = (id: string, invoiceNumber: string) => void;

interface InvoiceFormProps {
  /** Existing invoice being edited; omitted on the create page. */
  initialDraft?: InvoiceDraft;
  /** Database id of the invoice being edited; omitted on the create page. */
  invoiceId?: string;
  /** The saved invoice's recorded payments; omitted on the create page. */
  initialPayments?: Payment[];
  /** GST rate in basis points a new invoice is written at, from the business's settings. */
  taxBasisPoints?: number;
}

export function InvoiceForm({
  initialDraft,
  invoiceId,
  initialPayments,
  taxBasisPoints = 0,
}: InvoiceFormProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [savedItems] = api.item.list.useSuspenseQuery();
  const [modules] = api.settings.modules.useSuspenseQuery();

  const [draft, rawDispatch] = useReducer(
    invoiceReducer,
    initialDraft,
    (existing) => existing ?? createInitialDraft(taxBasisPoints),
  );
  const [showErrors, setShowErrors] = useState(false);
  /**
   * Whether the customer's details were edited in place during this sitting. An
   * invoice reopened later still differs from the customer record — that is the
   * snapshot doing its job — and re-asking about a decision already made is how
   * people learn to dismiss the prompt without reading it.
   */
  const [customerDetailsTouched, setCustomerDetailsTouched] = useState(false);
  /**
   * Whether the bill-to fields describe a customer who does not exist yet. They
   * are written on the way through the invoice's own save, so an invoice that is
   * abandoned half-filled leaves no customer behind.
   */
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ onSaved?: SavedHandler } | null>(null);
  const [exporting, setExporting] = useState(false);
  /** The number a save was rejected for, kept so the field can own the error. */
  const [numberConflict, setNumberConflict] = useState<{
    invoiceNumber: string;
    message: string;
  } | null>(null);
  /** Edits since the last save, payments included. Leaving the page with any asks first. */
  const [dirty, setDirty] = useState(false);

  const sendEmail = api.invoice.sendEmail.useMutation();
  const resetSendEmail = sendEmail.reset;

  const tierId = draft.customerDetails.tierId;
  const dispatch = useCallback(
    (action: InvoiceAction) => {
      setDirty(true);
      // A stale "Sent to …" confirmation shouldn't outlive the edit it predates.
      resetSendEmail();
      if (action.type === "patchCustomerDetails") setCustomerDetailsTouched(true);
      if (action.type === "fillDetailsFromCustomer") {
        setCustomerDetailsTouched(false);
        setCreatingCustomer(false);
      }
      if (action.type === "startNewCustomer") {
        setCustomerDetailsTouched(false);
        setCreatingCustomer(true);
      }
      rawDispatch(action);
      // Any action that lands on a different tier re-prices the lines already on
      // the invoice (only those still at the old tier's catalog price).
      const newTierId =
        action.type === "patchCustomerDetails"
          ? action.patch.tierId
          : action.type === "fillDetailsFromCustomer"
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
      setDirty(false);
      await utils.invoice.invalidate();
      router.push(`/invoices/${id}/edit`);
    },
  });
  const updateInvoice = api.invoice.update.useMutation({
    onSuccess: async () => {
      setDirty(false);
      await utils.invoice.invalidate();
    },
    onError: (error, { draft: attempted }) => {
      // A number already on another invoice is the only clash a save is refused for.
      if (error.data?.code === "CONFLICT") {
        setNumberConflict({ invoiceNumber: attempted.invoiceNumber, message: error.message });
      }
    },
  });

  const createCustomer = api.customer.create.useMutation();
  const savePayments = api.invoice.savePayments.useMutation({
    onSuccess: async () => {
      setDirty(false);
      await utils.invoice.invalidate();
    },
  });

  const saving =
    createInvoice.isPending ||
    updateInvoice.isPending ||
    createCustomer.isPending ||
    savePayments.isPending;
  // A clashing number is shown on the field, so it never doubles up down here.
  const saveError =
    updateInvoice.error?.data?.code === "CONFLICT"
      ? undefined
      : (createInvoice.error ?? updateInvoice.error ?? createCustomer.error ?? savePayments.error)
          ?.message;

  // Payments sit beside the draft rather than in it, but wait for Save the same
  // way. If the module is turned off meanwhile they drop out, as from every read,
  // and a save leaves the stored ones alone.
  const [recordedPayments, setRecordedPayments] = useState(initialPayments ?? []);
  const payments = modules.payments ? recordedPayments : [];
  const paidCents = paymentsTotalCents(payments);
  const changePayments = (next: Payment[]) => {
    setDirty(true);
    resetSendEmail();
    setRecordedPayments(next);
  };

  const totals = computeTotals(draft, paidCents);
  const locking = lockingModules(draft.lineItems, modules);
  const locked = locking.length > 0;
  // Only an edit has a number field, so only an edit can be missing a number.
  const editing = invoiceId !== undefined;
  // A new invoice has nothing saved until it's created.
  const saved = !dirty && (editing || createInvoice.isSuccess);
  const errors = showErrors ? validateDraft(draft, editing) : null;
  // Text an input refused to commit, held on its field until it is fixed.
  const [fieldErrors, reportFieldError] = useFieldErrors();
  // Dropped as soon as the number is edited to anything else.
  const conflictError =
    numberConflict?.invoiceNumber === draft.invoiceNumber ? numberConflict.message : undefined;
  const invoiceNumberError = errors?.invoiceNumber ?? conflictError;
  const errorsAbove =
    [invoiceNumberError, errors?.customerDetails, errors?.lineItems].filter(
      (message) => message !== undefined,
    ).length + fieldErrors.size;

  const customers = api.customer.list.useQuery().data ?? [];
  const updateCustomer = api.customer.update.useMutation();
  const selectedCustomer = customers.find((customer) => customer.id === draft.customerId);
  const customerDiverged =
    selectedCustomer !== undefined &&
    !customerDetailsMatchesCustomer(draft.customerDetails, selectedCustomer);
  // Named the way the picker lists them, so it is unambiguous which record is
  // about to change when two customers share a contact name.
  const selectedCustomerLabel = (() => {
    if (selectedCustomer === undefined) return "";
    const display = customerDisplayName(selectedCustomer);
    const company = selectedCustomer.company.trim();
    return company === "" || company === display ? display : `${display} · ${company}`;
  })();

  const commit = (toSave: InvoiceDraft, onSaved?: SavedHandler) => {
    // Every saved invoice is billed to a customer record. persist() gates on
    // validation and save() creates the record first, so this never fires.
    const { customerId, invoiceNumber, ...rest } = toSave;
    if (customerId === null) return;
    const base = { ...rest, customerId };
    setShowErrors(false);
    if (invoiceId) {
      updateInvoice.mutate(
        { id: invoiceId, draft: { ...base, invoiceNumber }, payments },
        { onSuccess: ({ id }) => onSaved?.(id, invoiceNumber) },
      );
    } else {
      // A new invoice sends no number: the server assigns one and hands it back.
      createInvoice.mutate(
        { ...base, payments },
        {
          onSuccess: ({ id, invoiceNumber: assigned }) => onSaved?.(id, assigned),
        },
      );
    }
  };

  /**
   * A customer typed straight into the invoice gets their record here, and the
   * invoice is billed to it. Validation has already run, so they are guaranteed
   * an identity to be found by again.
   */
  const save = (onSaved?: SavedHandler) => {
    if (!creatingCustomer) {
      commit(draft, onSaved);
      return;
    }
    createCustomer.mutate(draft.customerDetails, {
      onSuccess: ({ id }) => {
        setCreatingCustomer(false);
        // Not a user edit, so it must not mark the invoice unsaved again.
        rawDispatch({ type: "patch", patch: { customerId: id } });
        void utils.customer.list.invalidate();
        commit({ ...draft, customerId: id }, onSaved);
      },
    });
  };

  const persist = (onSaved?: SavedHandler) => {
    if (saving) return;
    // Payments are all that can change on a locked invoice, so they're all its save
    // sends; with none changed, export and email go straight ahead.
    if (locked) {
      if (!invoiceId) return;
      const done = () => onSaved?.(invoiceId, draft.invoiceNumber);
      if (dirty) savePayments.mutate({ invoiceId, payments }, { onSuccess: done });
      else done();
      return;
    }
    if (validateDraft(draft, editing) || fieldErrors.size > 0) {
      setShowErrors(true);
      return;
    }
    // The edit menu in the bill-to section is easy to walk past while looking at
    // line items. Saving is the moment they are demonstrably finished with the
    // invoice, so it is the last honest place to ask where the change belongs.
    if (customerDetailsTouched && customerDiverged) {
      setPendingSave({ onSaved });
      return;
    }
    save(onSaved);
  };

  const resolveCustomerDetailsDivergence = (updateRecord: boolean) => {
    const pending = pendingSave;
    setPendingSave(null);
    setCustomerDetailsTouched(false);
    if (updateRecord && selectedCustomer !== undefined) {
      updateCustomer.mutate(
        { id: selectedCustomer.id, details: draft.customerDetails },
        { onSuccess: () => void utils.customer.list.invalidate() },
      );
    }
    save(pending?.onSaved);
  };

  const handleExportPdf = async (invoiceNumber: string) => {
    if (exporting) return;
    setExporting(true);
    try {
      // The PDF renderer is heavy, so it only loads when an export is requested.
      const [{ invoicePdfBlob }, settings] = await Promise.all([
        import("../_lib/invoice-pdf"),
        utils.settings.get.ensureData(),
      ]);
      const blob = await invoicePdfBlob({ ...draft, invoiceNumber }, settings, paidCents);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoiceNumber.trim() || "invoice"}.pdf`;
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
            : draft.isQuote
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
              key={option.label}
              type="button"
              disabled={locked}
              className={cn(
                "px-3 py-1.5 text-sm",
                draft.isQuote === option.isQuote
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => dispatch({ type: "patch", patch: { isQuote: option.isQuote } })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {locked && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
          <p className="text-sm">
            This {draft.isQuote ? "quote" : "invoice"} can&apos;t be edited while{" "}
            {locking.join(" and ")} {locking.length > 1 ? "are" : "is"} turned off.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/modules">Module settings</Link>
          </Button>
        </div>
      )}
      <div className="bg-card rounded-xl border shadow-sm">
        <FieldErrorsContext value={reportFieldError}>
          <div className="space-y-8 p-8 sm:p-10">
            <fieldset disabled={locked} className="min-w-0 space-y-8">
              <CustomerDetailsSection
                customerDetails={draft.customerDetails}
                customerId={draft.customerId}
                creating={creatingCustomer}
                hasDeliveryAddress={draft.hasDeliveryAddress}
                deliverySameAsBilling={draft.deliverySameAsBilling}
                error={errors?.customerDetails}
                dispatch={dispatch}
              />
              <InvoiceMeta
                draft={draft}
                showInvoiceNumber={editing}
                invoiceNumberError={invoiceNumberError}
                dispatch={dispatch}
              />
              <LineItemsGrid
                items={draft.lineItems}
                savedItems={savedItems}
                tierId={draft.customerDetails.tierId}
                invalidItemIds={errors?.invalidLineItemIds ?? []}
                error={errors?.lineItems}
                taxBasisPoints={documentTaxBasisPoints(draft)}
                locked={locked}
                dispatch={dispatch}
              />
            </fieldset>
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
              <section className="flex-1 space-y-2">
                <Label htmlFor="invoice-notes">Notes</Label>
                <Textarea
                  id="invoice-notes"
                  disabled={locked}
                  rows={4}
                  placeholder={`Notes to appear on the ${draft.isQuote ? "quote" : "invoice"}...`}
                  value={draft.notes}
                  onChange={(e) =>
                    dispatch({ type: "patch", patch: { notes: e.currentTarget.value } })
                  }
                />
              </section>
              <TotalsPanel
                totals={totals}
                discount={draft.discount}
                deliveryCents={draft.deliveryCents}
                taxBasisPoints={documentTaxBasisPoints(draft)}
                isQuote={draft.isQuote}
                payments={payments}
                onPaymentsChange={changePayments}
                showPayments={modules.payments}
                locked={locked}
                dispatch={dispatch}
              />
            </div>
          </div>
        </FieldErrorsContext>
        <StickyActionBar
          amount={
            modules.payments
              ? { label: "Balance due", cents: totals.balanceCents }
              : { label: "Total", cents: totals.totalCents }
          }
          autosaveStatus={saving ? "saving" : saved ? "saved" : "idle"}
          saveError={saveError}
          errorsAbove={errorsAbove}
          locked={locked && !dirty}
          exporting={exporting}
          sending={sendEmail.isPending}
          sendError={sendEmail.error?.message}
          sentTo={sendEmail.data?.sentTo}
          onSave={() => persist()}
          onSaveAndExport={() => persist((_id, assigned) => void handleExportPdf(assigned))}
          onSaveAndEmail={() => persist((id) => sendEmail.mutate({ id }))}
        />
      </div>

      <LeaveGuard when={dirty} />
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
              This invoice has different details for {selectedCustomerLabel}. Save them to that
              customer as well, or keep the change on this invoice only?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => resolveCustomerDetailsDivergence(false)}>
              Just this invoice
            </Button>
            <Button onClick={() => resolveCustomerDetailsDivergence(true)}>Update customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
