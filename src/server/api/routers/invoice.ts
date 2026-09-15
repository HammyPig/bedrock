import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { z } from "zod";

import { lockingModules } from "~/app/invoices/_lib/invoice";
import {
  basisPointsSchema,
  computeTotals,
  paymentsTotalCents,
  quantityMilliSchema,
  resolveDiscount,
  storedDiscountCents,
} from "~/app/invoices/_lib/money";
import {
  type Invoice,
  type InvoiceDraft,
  type LineItem,
  type PaymentMethod,
} from "~/app/invoices/_lib/types";
import { centsSchema } from "~/lib/money";
import { customerDetailsInput } from "~/server/api/routers/customer";
import {
  assignNextInvoiceNumber,
  loadModules,
  loadSettings,
  paymentsProcedure,
  type Transaction,
} from "~/server/api/routers/settings";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { sendInvoiceEmail } from "~/server/email";
import { invoiceLineItems, invoices, payments } from "~/server/db/schema";
import { type db as database } from "~/server/db";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

/** Shared with the purchase-order router, which uses the base shape as-is. */
export const lineItemBaseInput = z.object({
  id: z.string().min(1).max(255),
  sku: z.string().max(64),
  name: z.string().min(1),
  quantityMilli: quantityMilliSchema,
  unitPriceCents: centsSchema,
  taxBasisPoints: basisPointsSchema,
});

const lineItemInput = lineItemBaseInput.extend({
  discountBasisPoints: basisPointsSchema,
  backordered: z.boolean(),
});

const draftInput = z.object({
  isQuote: z.boolean(),
  invoiceNumber: z.string().min(1).max(64),
  customerDetails: customerDetailsInput,
  customerId: z.string().max(255),
  hasDeliveryAddress: z.boolean(),
  deliverySameAsBilling: z.boolean(),
  issueDate: isoDate,
  terms: z.enum(["due_on_receipt", "net_7", "net_14", "net_30", "custom"]),
  customDueDate: isoDate.nullable(),
  lineItems: z
    .array(lineItemInput)
    .min(1)
    .refine(
      (lines) => new Set(lines.map((line) => line.id)).size === lines.length,
      "Line item ids must be unique.",
    ),
  discount: z
    .object({
      basisPoints: basisPointsSchema,
      amountCents: centsSchema,
    })
    .nullable(),
  deliveryCents: centsSchema,
  deliveryTaxBasisPoints: basisPointsSchema,
  notes: z.string(),
}) satisfies z.ZodType<InvoiceDraft>;

const paymentMethodInput = z.enum([
  "bank_transfer",
  "card",
  "cash",
  "cheque",
  "other",
]) satisfies z.ZodType<PaymentMethod>;

const paymentInput = z.object({
  // Given by the editor, so a later save can tell the payments already stored from new ones.
  id: z.string().min(1).max(255),
  amountCents: centsSchema.positive(),
  paidDate: isoDate,
  method: paymentMethodInput,
});
type PaymentInput = z.infer<typeof paymentInput>;

/**
 * A new invoice is numbered by the business's counter, so it sends no number.
 * It brings along the payments recorded on it before its first save.
 */
const createInput = draftInput
  .omit({ invoiceNumber: true })
  .extend({ payments: z.array(paymentInput) });

/**
 * The rows a draft is stored as: rates and amounts as they were asked for, plus
 * the total — the one worked-out figure kept, so a read that only needs the total
 * can skip the lines. It's worked out here, never taken from the client.
 */
function toRows(draft: z.infer<typeof draftInput>) {
  const { lineItems, discount, ...columns } = draft;
  return {
    columns: {
      ...columns,
      discountCents: storedDiscountCents(discount, lineItems),
      discountBasisPoints: discount?.basisPoints ?? 0,
      totalCents: computeTotals(draft).totalCents,
    },
    lineItems: lineItems.map((line, position) => ({ ...line, position })),
  };
}

/**
 * The stored discount, or null when none was given. A percent discount is stored
 * as its rate and a fixed one as its amount, so a discount exists when either is
 * set — a discount of exactly nothing is not one worth keeping.
 */
function rowDiscount(row: { discountCents: number; discountBasisPoints: number }) {
  return row.discountCents > 0 || row.discountBasisPoints > 0
    ? { basisPoints: row.discountBasisPoints, amountCents: row.discountCents }
    : null;
}

type InvoiceRow = typeof invoices.$inferSelect & {
  lineItems: (typeof invoiceLineItems.$inferSelect)[];
  payments: (typeof payments.$inferSelect)[];
};

/** Shared by list/get/sendEmail so every read returns the same Invoice shape. */
const invoiceWith = {
  lineItems: { orderBy: [asc(invoiceLineItems.position)] },
  payments: { orderBy: [asc(payments.paidDate), asc(payments.createdAt)] },
};

function toInvoice(row: InvoiceRow, paymentsOn: boolean): Invoice {
  return {
    id: row.id,
    draft: {
      isQuote: row.isQuote,
      invoiceNumber: row.invoiceNumber,
      customerDetails: row.customerDetails,
      customerId: row.customerId,
      hasDeliveryAddress: row.hasDeliveryAddress,
      deliverySameAsBilling: row.deliverySameAsBilling,
      issueDate: row.issueDate,
      terms: row.terms,
      customDueDate: row.customDueDate,
      lineItems: row.lineItems.map((line) => ({
        id: line.id,
        sku: line.sku,
        name: line.name,
        quantityMilli: line.quantityMilli,
        unitPriceCents: line.unitPriceCents,
        discountBasisPoints: line.discountBasisPoints,
        taxBasisPoints: line.taxBasisPoints,
        backordered: line.backordered,
      })),
      // A percent discount is stored without its cents, so they're filled back in.
      discount: resolveDiscount(rowDiscount(row), row.lineItems),
      deliveryCents: row.deliveryCents,
      deliveryTaxBasisPoints: row.deliveryTaxBasisPoints,
      notes: row.notes,
    },
    totalCents: row.totalCents,
    // With the module off, payments stay out of every read so balances, the
    // PDF and the email all fall back to the invoice's total.
    payments: paymentsOn
      ? row.payments.map((payment) => ({
          id: payment.id,
          amountCents: payment.amountCents,
          paidDate: payment.paidDate,
          method: payment.method,
        }))
      : [],
  };
}

async function assertInvoiceNumberFree(
  db: typeof database,
  businessId: string,
  invoiceNumber: string,
  excludeId?: string,
) {
  const existing = await db.query.invoices.findFirst({
    columns: { id: true },
    where: and(
      eq(invoices.businessId, businessId),
      eq(invoices.invoiceNumber, invoiceNumber),
      excludeId === undefined ? undefined : ne(invoices.id, excludeId),
    ),
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Invoice number ${invoiceNumber} already exists.`,
    });
  }
}

/** The server side of the editor's lock: an invoice using a turned-off module can't be saved. */
async function assertModulesOn(db: typeof database, businessId: string, lineItems: LineItem[]) {
  const locking = lockingModules(lineItems, await loadModules(db, businessId));
  if (locking.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Turn on ${locking.join(" and ")} in Settings → Modules to save this invoice.`,
    });
  }
}

/**
 * Whether a save writes the payments it was sent. The editor shows none while
 * Payments is off, so then an empty list leaves the stored ones alone and any
 * other list is refused.
 */
async function writesPayments(db: typeof database, businessId: string, list: PaymentInput[]) {
  if ((await loadModules(db, businessId)).payments) return true;
  if (list.length > 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Payments are turned off." });
  }
  return false;
}

/**
 * Makes `list` the invoice's payments. Ones already stored are left as they are,
 * keeping their place among payments on the same date.
 */
async function replacePayments(tx: Transaction, invoiceId: string, list: PaymentInput[]) {
  const ids = list.map((payment) => payment.id);
  await tx
    .delete(payments)
    .where(
      and(
        eq(payments.invoiceId, invoiceId),
        ids.length > 0 ? notInArray(payments.id, ids) : undefined,
      ),
    );
  if (list.length === 0) return;
  await tx
    .insert(payments)
    .values(list.map((payment) => ({ ...payment, invoiceId })))
    .onConflictDoNothing({ target: payments.id });
}

export const invoiceRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const modules = await loadModules(ctx.db, ctx.businessId);
    const rows = await ctx.db.query.invoices.findMany({
      where: eq(invoices.businessId, ctx.businessId),
      with: invoiceWith,
    });
    return rows.map((row) => toInvoice(row, modules.payments));
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.invoices.findFirst({
      where: and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)),
      with: invoiceWith,
    });
    if (!row) return null;
    const modules = await loadModules(ctx.db, ctx.businessId);
    return toInvoice(row, modules.payments);
  }),

  create: businessProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const businessId = ctx.businessId;
    const { payments: newPayments, ...draft } = input;
    await assertModulesOn(ctx.db, businessId, draft.lineItems);
    const withPayments = await writesPayments(ctx.db, businessId, newPayments);
    return ctx.db.transaction(async (tx) => {
      // Inside the transaction, so a number is only spent by an invoice that saves.
      const invoiceNumber = await assignNextInvoiceNumber(tx, businessId);
      const { columns, lineItems } = toRows({ ...draft, invoiceNumber });
      const [created] = await tx
        .insert(invoices)
        .values({ ...columns, businessId })
        .returning({ id: invoices.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx
        .insert(invoiceLineItems)
        .values(lineItems.map((line) => ({ ...line, invoiceId: created.id })));
      if (withPayments) await replacePayments(tx, created.id, newPayments);
      return { id: created.id, invoiceNumber };
    });
  }),

  update: businessProcedure
    .input(z.object({ id: z.string(), draft: draftInput, payments: z.array(paymentInput) }))
    .mutation(async ({ ctx, input }) => {
      const businessId = ctx.businessId;
      await assertInvoiceNumberFree(ctx.db, businessId, input.draft.invoiceNumber, input.id);
      await assertModulesOn(ctx.db, businessId, input.draft.lineItems);
      const withPayments = await writesPayments(ctx.db, businessId, input.payments);

      const { columns, lineItems } = toRows(input.draft);
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(invoices)
          .set(columns)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, businessId)))
          .returning({ id: invoices.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, input.id));
        await tx
          .insert(invoiceLineItems)
          .values(lineItems.map((line) => ({ ...line, invoiceId: input.id })));
        if (withPayments) await replacePayments(tx, input.id, input.payments);
      });
      return { id: input.id };
    }),

  /** A locked invoice's save: its payments are all that can still change on it. */
  savePayments: paymentsProcedure
    .input(z.object({ invoiceId: z.string(), payments: z.array(paymentInput) }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.query.invoices.findFirst({
        columns: { id: true },
        where: and(eq(invoices.id, input.invoiceId), eq(invoices.businessId, ctx.businessId)),
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.transaction((tx) => replacePayments(tx, input.invoiceId, input.payments));
    }),

  /** Records each invoice's remaining balance as a payment — the bulk "customer paid up" action. */
  recordFullPayments: paymentsProcedure
    .input(
      z.object({
        invoiceIds: z.array(z.string()).min(1).max(500),
        paidDate: isoDate,
        method: paymentMethodInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.query.invoices.findMany({
        where: and(eq(invoices.businessId, ctx.businessId), inArray(invoices.id, input.invoiceIds)),
        with: { payments: true },
      });
      // Balances come from the database, not the client, so a stale page can't over-record.
      const values = rows.flatMap((row) => {
        if (row.isQuote) return [];
        const balanceCents = row.totalCents - paymentsTotalCents(row.payments);
        return balanceCents > 0
          ? [
              {
                invoiceId: row.id,
                amountCents: balanceCents,
                paidDate: input.paidDate,
                method: input.method,
              },
            ]
          : [];
      });
      if (values.length > 0) await ctx.db.insert(payments).values(values);
      return { recorded: values.length };
    }),

  /** Emails the saved invoice, PDF attached, to the bill-to email address. */
  sendEmail: businessProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)),
        with: invoiceWith,
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const modules = await loadModules(ctx.db, ctx.businessId);
      const invoice = toInvoice(row, modules.payments);
      const to = invoice.draft.customerDetails.email.trim();
      if (to === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an email address to the billing details first.",
        });
      }

      const settings = await loadSettings(ctx.db, ctx.businessId);
      await sendInvoiceEmail(to, invoice.draft, settings, paymentsTotalCents(invoice.payments));
      return { sentTo: to };
    }),

  /** Whether a number is already on an invoice — warns before it is set as the counter. */
  numberTaken: businessProcedure
    .input(z.object({ invoiceNumber: z.string() }))
    .query(async ({ ctx, input }) => {
      const existing = await ctx.db.query.invoices.findFirst({
        columns: { id: true },
        where: and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.invoiceNumber, input.invoiceNumber),
        ),
      });
      return existing !== undefined;
    }),
});
