import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { computeTotals, paymentsTotalCents } from "~/app/invoices/_lib/money";
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
  discountPercent: z.number().min(0).max(100),
});

const lineItemInput = lineItemBaseInput.extend({ backordered: z.boolean() });

const draftInput = z.object({
  isQuote: z.boolean(),
  invoiceNumber: z.string().min(1).max(64),
  customerDetails: customerDetailsInput,
  customerId: z.string().max(255),
  delivery: z.boolean(),
  deliverySameAsBilling: z.boolean(),
  poNumber: z.string().max(64),
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
  discount: z.object({ mode: z.enum(["percent", "fixed"]), value: z.number().min(0) }).nullable(),
  freightCents: z.number().int().min(0),
  taxRatePercent: z.number().min(0),
  notes: z.string(),
}) satisfies z.ZodType<InvoiceDraft>;

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
      delivery: row.delivery,
      deliverySameAsBilling: row.deliverySameAsBilling,
      poNumber: row.poNumber,
      issueDate: row.issueDate,
      terms: row.terms,
      customDueDate: row.customDueDate,
      lineItems: row.lineItems.map((line) => ({
        id: line.id,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountPercent: line.discountPercent,
        backordered: line.backordered,
      })),
      discount: row.discount,
      freightCents: row.freightCents,
      taxRatePercent: row.taxRatePercent,
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

    const { lineItems, ...invoiceColumns } = input;
    return ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invoices)
        .values({ ...invoiceColumns, businessId })
        .returning({ id: invoices.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx
        .insert(invoiceLineItems)
        .values(lineItems.map((line, position) => ({ ...line, invoiceId: created.id, position })));
      return { id: created.id };
    });
  }),

  update: businessProcedure
    .input(z.object({ id: z.string(), draft: draftInput }))
    .mutation(async ({ ctx, input }) => {
      const businessId = ctx.businessId;
      await assertInvoiceNumberFree(ctx.db, businessId, input.draft.invoiceNumber, input.id);

      const { lineItems, ...invoiceColumns } = input.draft;
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(invoices)
          .set(invoiceColumns)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, businessId)))
          .returning({ id: invoices.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, input.id));
        await tx
          .insert(invoiceLineItems)
          .values(lineItems.map((line, position) => ({ ...line, invoiceId: input.id, position })));
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
        const { balanceCents } = computeTotals(row, paymentsTotalCents(row.payments));
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
