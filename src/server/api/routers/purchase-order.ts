import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { type PurchaseOrder, type PurchaseOrderDraft } from "~/app/purchase-orders/_lib/types";
import { isoDate, lineItemInput } from "~/server/api/routers/invoice";
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
}) satisfies z.ZodType<PurchaseOrderDraft>;

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
      })),
      discount: row.discount,
      freightCents: row.freightCents,
      taxRatePercent: row.taxRatePercent,
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

    const { lineItems, ...orderColumns } = input;
    return ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchaseOrders)
        .values({ ...orderColumns, businessId })
        .returning({ id: purchaseOrders.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx.insert(purchaseOrderLineItems).values(
        lineItems.map((line, position) => ({
          ...line,
          purchaseOrderId: created.id,
          position,
        })),
      );
      return { id: created.id };
    });
  }),

  update: businessProcedure
    .input(z.object({ id: z.string(), draft: draftInput }))
    .mutation(async ({ ctx, input }) => {
      const businessId = ctx.businessId;
      await assertPoNumberFree(ctx.db, businessId, input.draft.poNumber, input.id);

      const { lineItems, ...orderColumns } = input.draft;
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(purchaseOrders)
          .set(orderColumns)
          .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.businessId, businessId)))
          .returning({ id: purchaseOrders.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await tx
          .delete(purchaseOrderLineItems)
          .where(eq(purchaseOrderLineItems.purchaseOrderId, input.id));
        await tx.insert(purchaseOrderLineItems).values(
          lineItems.map((line, position) => ({
            ...line,
            purchaseOrderId: input.id,
            position,
          })),
        );
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
