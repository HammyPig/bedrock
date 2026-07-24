import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { type Invoice, type InvoiceDraft } from "~/app/invoices/_lib/types";
import { billToInput } from "~/server/api/routers/customer";
import { loadEffectiveSettings } from "~/server/api/routers/settings";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { sendInvoiceEmail } from "~/server/email";
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
      with: { lineItems: { orderBy: [asc(invoiceLineItems.position)] } },
    });
    return rows.map(toInvoice);
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.invoices.findFirst({
      where: and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)),
      with: { lineItems: { orderBy: [asc(invoiceLineItems.position)] } },
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

  /** Emails the saved invoice, PDF attached, to the bill-to email address. */
  sendEmail: businessProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.invoices.findFirst({
        where: and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)),
        with: { lineItems: { orderBy: [asc(invoiceLineItems.position)] } },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const { draft } = toInvoice(row);
      const to = draft.billTo.email.trim();
      if (to === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an email address to the billing details first.",
        });
      }

      const settings = await loadEffectiveSettings(ctx.db, ctx.businessId);
      await sendInvoiceEmail(to, draft, settings);
      return { sentTo: to };
    }),

  /** Suggested number for the next invoice, from the business's numbering settings. */
  nextNumber: businessProcedure.query(async ({ ctx }) => {
    const settings = await loadEffectiveSettings(ctx.db, ctx.businessId);
    return settings.invoiceNumberPrefix + settings.nextInvoiceNumber;
  }),
});
