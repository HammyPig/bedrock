import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import {
  computeBreakdown,
  computeTotals,
  MAX_BASIS_POINTS,
  paymentsTotalCents,
} from "~/app/invoices/_lib/money";
import { type Invoice, type InvoiceDraft } from "~/app/invoices/_lib/types";
import { customerDetailsInput } from "~/server/api/routers/customer";
import { loadEffectiveSettings } from "~/server/api/routers/settings";
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
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().min(0),
  discountBasisPoints: z.number().int().min(0).max(MAX_BASIS_POINTS),
  taxBasisPoints: z.number().int().min(0).max(MAX_BASIS_POINTS),
});

const lineItemInput = lineItemBaseInput.extend({ backordered: z.boolean() });

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
      basisPoints: z.number().int().min(0).max(MAX_BASIS_POINTS),
      amountCents: z.number().int().min(0),
    })
    .nullable(),
  deliveryCents: z.number().int().min(0),
  deliveryTaxBasisPoints: z.number().int().min(0).max(MAX_BASIS_POINTS),
  notes: z.string(),
}) satisfies z.ZodType<InvoiceDraft>;

/**
 * The rows a draft is stored as. Every cents figure is derived here from the
 * percents the client sent rather than taken from it, so what is banked can
 * never disagree with what it was worked out from.
 */
function toRows(draft: z.infer<typeof draftInput>) {
  const breakdown = computeBreakdown(draft);
  const { lineItems, discount, ...columns } = draft;
  return {
    columns: {
      ...columns,
      discountCents: breakdown.discountCents,
      discountBasisPoints: discount?.basisPoints ?? 0,
      deliveryTaxCents: breakdown.deliveryTaxCents,
    },
    lineItems: lineItems.map((line, position) => ({
      ...line,
      position,
      discountCents: breakdown.lines[position]?.discountCents ?? 0,
      taxCents: breakdown.lines[position]?.taxCents ?? 0,
    })),
  };
}

/**
 * The stored discount, or null when none was given. Cents is always written, so
 * a discount exists when it came to something or when a rate was recorded —
 * a discount of exactly nothing is not one worth keeping.
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

function toInvoice(row: InvoiceRow): Invoice {
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
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountBasisPoints: line.discountBasisPoints,
        taxBasisPoints: line.taxBasisPoints,
        backordered: line.backordered,
      })),
      discount: rowDiscount(row),
      deliveryCents: row.deliveryCents,
      deliveryTaxBasisPoints: row.deliveryTaxBasisPoints,
      notes: row.notes,
    },
    payments: row.payments.map((payment) => ({
      id: payment.id,
      amountCents: payment.amountCents,
      paidDate: payment.paidDate,
    })),
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

export const invoiceRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.invoices.findMany({
      where: eq(invoices.businessId, ctx.businessId),
      with: invoiceWith,
    });
    return rows.map(toInvoice);
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.invoices.findFirst({
      where: and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)),
      with: invoiceWith,
    });
    return row ? toInvoice(row) : null;
  }),

  create: businessProcedure.input(draftInput).mutation(async ({ ctx, input }) => {
    const businessId = ctx.businessId;
    await assertInvoiceNumberFree(ctx.db, businessId, input.invoiceNumber);

    const { columns, lineItems } = toRows(input);
    return ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invoices)
        .values({ ...columns, businessId })
        .returning({ id: invoices.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx
        .insert(invoiceLineItems)
        .values(lineItems.map((line) => ({ ...line, invoiceId: created.id })));
      return { id: created.id };
    });
  }),

  update: businessProcedure
    .input(z.object({ id: z.string(), draft: draftInput }))
    .mutation(async ({ ctx, input }) => {
      const businessId = ctx.businessId;
      await assertInvoiceNumberFree(ctx.db, businessId, input.draft.invoiceNumber, input.id);

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
      });
      return { id: input.id };
    }),

  /** Records a payment received against an invoice. */
  addPayment: businessProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        amountCents: z.number().int().positive(),
        paidDate: isoDate,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.query.invoices.findFirst({
        columns: { id: true },
        where: and(eq(invoices.id, input.invoiceId), eq(invoices.businessId, ctx.businessId)),
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      const [created] = await ctx.db.insert(payments).values(input).returning({ id: payments.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id: created.id };
    }),

  deletePayment: businessProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const payment = await ctx.db.query.payments.findFirst({
        columns: { id: true },
        where: eq(payments.id, input.id),
        with: { invoice: { columns: { businessId: true } } },
      });
      if (payment?.invoice.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.delete(payments).where(eq(payments.id, input.id));
    }),

  /** Records each invoice's remaining balance as a payment — the bulk "customer paid up" action. */
  recordFullPayments: businessProcedure
    .input(z.object({ invoiceIds: z.array(z.string()).min(1).max(500), paidDate: isoDate }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.query.invoices.findMany({
        where: and(eq(invoices.businessId, ctx.businessId), inArray(invoices.id, input.invoiceIds)),
        with: invoiceWith,
      });
      // Balances come from the database, not the client, so a stale page can't over-record.
      const values = rows.flatMap((row) => {
        if (row.isQuote) return [];
        const { balanceCents } = computeTotals(
          { ...row, discount: rowDiscount(row) },
          paymentsTotalCents(row.payments),
        );
        return balanceCents > 0
          ? [{ invoiceId: row.id, amountCents: balanceCents, paidDate: input.paidDate }]
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

      const invoice = toInvoice(row);
      const to = invoice.draft.customerDetails.email.trim();
      if (to === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an email address to the billing details first.",
        });
      }

      const settings = await loadEffectiveSettings(ctx.db, ctx.businessId);
      await sendInvoiceEmail(to, invoice.draft, settings, paymentsTotalCents(invoice.payments));
      return { sentTo: to };
    }),

  /** Suggested number for the next invoice, from the business's numbering settings. */
  nextNumber: businessProcedure.query(async ({ ctx }) => {
    const settings = await loadEffectiveSettings(ctx.db, ctx.businessId);
    return settings.invoiceNumberPrefix + settings.nextInvoiceNumber;
  }),
});
