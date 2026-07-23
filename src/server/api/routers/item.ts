import { TRPCError } from "@trpc/server";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { items } from "~/server/db/schema";

const itemRowInput = z.object({
  id: z.string().min(1).max(255),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  unitPriceCents: z.number().int().min(0),
});

/** Comparison key only — mirrors the items page's client-side validation. */
function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function toItemRow(row: typeof items.$inferSelect) {
  return { id: row.id, sku: row.sku, name: row.name, unitPriceCents: row.unitPriceCents };
}

export const itemRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.items.findMany({
      where: eq(items.businessId, ctx.businessId),
      orderBy: [asc(items.createdAt), asc(items.id)],
    });
    return rows.map(toItemRow);
  }),

  /**
   * Replaces the business's catalog with the submitted grid: rows with a known
   * id are updated, unknown ids are inserted fresh, and anything missing from
   * the submission is deleted. Returns the saved catalog so the client can
   * reset its working copy to canonical ids and order.
   */
  saveAll: businessProcedure.input(z.array(itemRowInput)).mutation(async ({ ctx, input }) => {
    const skus = input.map((row) => normalizeSku(row.sku));
    if (new Set(skus).size !== skus.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Each item needs a unique SKU." });
    }

    const businessId = ctx.businessId;
    await ctx.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: items.id })
        .from(items)
        .where(eq(items.businessId, businessId));
      const existingIds = new Set(existing.map((row) => row.id));
      const keptIds = input.map((row) => row.id).filter((id) => existingIds.has(id));

      await tx
        .delete(items)
        .where(
          keptIds.length > 0
            ? and(eq(items.businessId, businessId), notInArray(items.id, keptIds))
            : eq(items.businessId, businessId),
        );

      for (const row of input) {
        const values = { sku: row.sku, name: row.name, unitPriceCents: row.unitPriceCents };
        if (existingIds.has(row.id)) {
          await tx
            .update(items)
            .set(values)
            .where(and(eq(items.id, row.id), eq(items.businessId, businessId)));
        } else {
          await tx.insert(items).values({ ...values, businessId });
        }
      }
    });

    const rows = await ctx.db.query.items.findMany({
      where: eq(items.businessId, businessId),
      orderBy: [asc(items.createdAt), asc(items.id)],
    });
    return rows.map(toItemRow);
  }),
});
