import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { type Invoice, type InvoiceDraft } from "~/app/invoices/_lib/types";
import { billToInput } from "~/server/api/routers/customer";
import { loadEffectiveSettings } from "~/server/api/routers/settings";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { invoiceLineItems, invoices } from "~/server/db/schema";
import { type db as database } from "~/server/db";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

const lineItemInput = z.object({
  id: z.string().min(1).max(255),
  sku: z.string().max(64),
  name: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().min(0),
  discountPercent: z.number().min(0).max(100),
});

const draftInput = z.object({
  invoiceNumber: z.string().min(1).max(64),
  billTo: billToInput,
  sourceCustomerId: z.string().max(255).nullable(),
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
  paidCents: z.number().int().min(0),
  notes: z.string(),
}) satisfies z.ZodType<InvoiceDraft>;

type InvoiceRow = typeof invoices.$inferSelect & {
  lineItems: (typeof invoiceLineItems.$inferSelect)[];
};

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    draft: {
      invoiceNumber: row.invoiceNumber,
      billTo: row.billTo,
      sourceCustomerId: row.sourceCustomerId,
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
      })),
      discount: row.discount,
      freightCents: row.freightCents,
      taxRatePercent: row.taxRatePercent,
      paidCents: row.paidCents,
      notes: row.notes,
    },
  };
}

async function assertInvoiceNumberFree(
  db: typeof database,
  userId: string,
  invoiceNumber: string,
  excludeId?: string,
) {
  const existing = await db.query.invoices.findFirst({
    columns: { id: true },
    where: and(
      eq(invoices.userId, userId),
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
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.invoices.findMany({
      where: eq(invoices.userId, ctx.session.user.id),
      with: { lineItems: { orderBy: [asc(invoiceLineItems.position)] } },
    });
    return rows.map(toInvoice);
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.invoices.findFirst({
      where: and(eq(invoices.id, input.id), eq(invoices.userId, ctx.session.user.id)),
      with: { lineItems: { orderBy: [asc(invoiceLineItems.position)] } },
    });
    return row ? toInvoice(row) : null;
  }),

  create: protectedProcedure.input(draftInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    await assertInvoiceNumberFree(ctx.db, userId, input.invoiceNumber);

    const { lineItems, ...invoiceColumns } = input;
    return ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invoices)
        .values({ ...invoiceColumns, userId })
        .returning({ id: invoices.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx
        .insert(invoiceLineItems)
        .values(lineItems.map((line, position) => ({ ...line, invoiceId: created.id, position })));
      return { id: created.id };
    });
  }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), draft: draftInput }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertInvoiceNumberFree(ctx.db, userId, input.draft.invoiceNumber, input.id);

      const { lineItems, ...invoiceColumns } = input.draft;
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(invoices)
          .set(invoiceColumns)
          .where(and(eq(invoices.id, input.id), eq(invoices.userId, userId)))
          .returning({ id: invoices.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, input.id));
        await tx
          .insert(invoiceLineItems)
          .values(lineItems.map((line, position) => ({ ...line, invoiceId: input.id, position })));
      });
      return { id: input.id };
    }),

  /** Suggested number for the next invoice, from the user's numbering settings. */
  nextNumber: protectedProcedure.query(async ({ ctx }) => {
    const settings = await loadEffectiveSettings(ctx.db, ctx.session.user.id);
    return settings.invoiceNumberPrefix + settings.nextInvoiceNumber;
  }),
});
