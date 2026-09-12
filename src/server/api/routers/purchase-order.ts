import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { computeBreakdown } from "~/app/invoices/_lib/money";
import { type PurchaseOrder, type PurchaseOrderDraft } from "~/app/purchase-orders/_lib/types";
import { isoDate, lineItemBaseInput } from "~/server/api/routers/invoice";
import { vendorDetailsInput } from "~/server/api/routers/vendor";
import { loadEffectiveSettings } from "~/server/api/routers/settings";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { sendPurchaseOrderEmail } from "~/server/email";
import { purchaseOrderLineItems, purchaseOrders } from "~/server/db/schema";
import { type db as database } from "~/server/db";

const draftInput = z.object({
  poNumber: z.string().min(1).max(64),
  vendor: vendorDetailsInput,
  sourceVendorId: z.string().max(255).nullable(),
  orderDate: isoDate,
  expectedDate: isoDate.nullable(),
  lineItems: z
    .array(lineItemBaseInput)
    .min(1)
    .refine(
      (lines) => new Set(lines.map((line) => line.id)).size === lines.length,
      "Line item ids must be unique.",
    ),
  discount: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("percent"), percent: z.number().min(0) }),
      z.object({ mode: z.literal("fixed"), amountCents: z.number().int().min(0) }),
    ])
    .nullable(),
  deliveryCents: z.number().int().min(0),
  deliveryTaxPercent: z.number().min(0).max(100),
  notes: z.string(),
}) satisfies z.ZodType<PurchaseOrderDraft>;

/** Mirrors the invoice router: the cents are derived here, never taken from the client. */
function toRows(draft: z.infer<typeof draftInput>) {
  const breakdown = computeBreakdown(draft);
  const { lineItems, ...columns } = draft;
  return {
    columns: { ...columns, deliveryTaxCents: breakdown.deliveryTaxCents },
    lineItems: lineItems.map((line, position) => ({
      ...line,
      position,
      taxCents: breakdown.lines[position]?.taxCents ?? 0,
    })),
  };
}

type PurchaseOrderRow = typeof purchaseOrders.$inferSelect & {
  lineItems: (typeof purchaseOrderLineItems.$inferSelect)[];
};

function toPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    draft: {
      poNumber: row.poNumber,
      vendor: row.vendor,
      sourceVendorId: row.sourceVendorId,
      orderDate: row.orderDate,
      expectedDate: row.expectedDate,
      lineItems: row.lineItems.map((line) => ({
        id: line.id,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountPercent: line.discountPercent,
        taxPercent: line.taxPercent,
      })),
      discount: row.discount,
      deliveryCents: row.deliveryCents,
      deliveryTaxPercent: row.deliveryTaxPercent,
      notes: row.notes,
    },
  };
}

async function assertPoNumberFree(
  db: typeof database,
  businessId: string,
  poNumber: string,
  excludeId?: string,
) {
  const existing = await db.query.purchaseOrders.findFirst({
    columns: { id: true },
    where: and(
      eq(purchaseOrders.businessId, businessId),
      eq(purchaseOrders.poNumber, poNumber),
      excludeId === undefined ? undefined : ne(purchaseOrders.id, excludeId),
    ),
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Purchase order number ${poNumber} already exists.`,
    });
  }
}

export const purchaseOrderRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.purchaseOrders.findMany({
      where: eq(purchaseOrders.businessId, ctx.businessId),
      with: { lineItems: { orderBy: [asc(purchaseOrderLineItems.position)] } },
    });
    return rows.map(toPurchaseOrder);
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.purchaseOrders.findFirst({
      where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.businessId, ctx.businessId)),
      with: { lineItems: { orderBy: [asc(purchaseOrderLineItems.position)] } },
    });
    return row ? toPurchaseOrder(row) : null;
  }),

  create: businessProcedure.input(draftInput).mutation(async ({ ctx, input }) => {
    const businessId = ctx.businessId;
    await assertPoNumberFree(ctx.db, businessId, input.poNumber);

    const { columns, lineItems } = toRows(input);
    return ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchaseOrders)
        .values({ ...columns, businessId })
        .returning({ id: purchaseOrders.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx
        .insert(purchaseOrderLineItems)
        .values(lineItems.map((line) => ({ ...line, purchaseOrderId: created.id })));
      return { id: created.id };
    });
  }),

  update: businessProcedure
    .input(z.object({ id: z.string(), draft: draftInput }))
    .mutation(async ({ ctx, input }) => {
      const businessId = ctx.businessId;
      await assertPoNumberFree(ctx.db, businessId, input.draft.poNumber, input.id);

      const { columns, lineItems } = toRows(input.draft);
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(purchaseOrders)
          .set(columns)
          .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.businessId, businessId)))
          .returning({ id: purchaseOrders.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await tx
          .delete(purchaseOrderLineItems)
          .where(eq(purchaseOrderLineItems.purchaseOrderId, input.id));
        await tx
          .insert(purchaseOrderLineItems)
          .values(lineItems.map((line) => ({ ...line, purchaseOrderId: input.id })));
      });
      return { id: input.id };
    }),

  /** Emails the saved purchase order, PDF attached, to the vendor's email address. */
  sendEmail: businessProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.purchaseOrders.findFirst({
        where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.businessId, ctx.businessId)),
        with: { lineItems: { orderBy: [asc(purchaseOrderLineItems.position)] } },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const { draft } = toPurchaseOrder(row);
      const to = draft.vendor.email.trim();
      if (to === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an email address to the vendor details first.",
        });
      }

      const settings = await loadEffectiveSettings(ctx.db, ctx.businessId);
      await sendPurchaseOrderEmail(to, draft, settings);
      return { sentTo: to };
    }),

  /** Suggested number for the next purchase order: PO-#### continuing from the highest used. */
  nextNumber: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.purchaseOrders.findMany({
      columns: { poNumber: true },
      where: eq(purchaseOrders.businessId, ctx.businessId),
    });
    const highest = rows.reduce((max, { poNumber }) => {
      const match = /^PO-(\d+)$/i.exec(poNumber.trim());
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `PO-${String(highest + 1).padStart(4, "0")}`;
  }),
});
