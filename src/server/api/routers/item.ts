import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { hashItemColumns, type ItemColumnHashes } from "~/lib/import-verify";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { items } from "~/server/db/schema";
import { type db as database } from "~/server/db";

const itemInput = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  vendor: z.string().max(256),
  barcode: z.string().max(64),
  unitPriceCents: z.number().int().min(0),
  tier1PriceCents: z.number().int().min(0),
  tier2PriceCents: z.number().int().min(0),
  tier3PriceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
});

/** Comparison key only — the user's own casing/spacing is never rewritten. */
function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function toItemRow(row: typeof items.$inferSelect) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    vendor: row.vendor,
    barcode: row.barcode,
    unitPriceCents: row.unitPriceCents,
    tier1PriceCents: row.tier1PriceCents,
    tier2PriceCents: row.tier2PriceCents,
    tier3PriceCents: row.tier3PriceCents,
    costCents: row.costCents,
  };
}

/** SKUs are compared normalized, so this scans the catalog rather than matching exactly. */
async function assertSkuFree(
  db: typeof database,
  businessId: string,
  sku: string,
  excludeId?: string,
) {
  const key = normalizeSku(sku);
  const rows = await db
    .select({ id: items.id, sku: items.sku })
    .from(items)
    .where(eq(items.businessId, businessId));
  if (rows.some((row) => row.id !== excludeId && normalizeSku(row.sku) === key)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `An item with SKU ${sku.trim()} already exists.`,
    });
  }
}

export const itemRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.items.findMany({
      where: eq(items.businessId, ctx.businessId),
      orderBy: [asc(items.createdAt), asc(items.id)],
    });
    return rows.map(toItemRow);
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.items.findFirst({
      where: and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)),
    });
    return row ? toItemRow(row) : null;
  }),

  create: businessProcedure.input(itemInput).mutation(async ({ ctx, input }) => {
    await assertSkuFree(ctx.db, ctx.businessId, input.sku);
    const [created] = await ctx.db
      .insert(items)
      .values({ ...input, businessId: ctx.businessId })
      .returning({ id: items.id });
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return { id: created.id };
  }),

  /** CSV import: rows whose SKU is already taken are skipped and reported, never overwritten. */
  bulkCreate: businessProcedure
    .input(z.object({ items: z.array(itemInput).min(1).max(10000) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ sku: items.sku })
        .from(items)
        .where(eq(items.businessId, ctx.businessId));
      const inCatalog = new Set(existing.map((row) => normalizeSku(row.sku)));

      const skipped: { index: number; reason: string }[] = [];
      const seen = new Set<string>();
      const toInsert: (typeof items.$inferInsert)[] = [];
      input.items.forEach((item, index) => {
        const key = normalizeSku(item.sku);
        if (inCatalog.has(key)) {
          skipped.push({ index, reason: `An item with SKU ${item.sku.trim()} already exists.` });
          return;
        }
        if (seen.has(key)) {
          skipped.push({
            index,
            reason: `SKU ${item.sku.trim()} appears earlier in the file; only the first row was imported.`,
          });
          return;
        }
        seen.add(key);
        toInsert.push({ ...item, businessId: ctx.businessId });
      });

      const insertedIds: string[] = [];
      if (toInsert.length > 0) {
        await ctx.db.transaction(async (tx) => {
          for (let i = 0; i < toInsert.length; i += 500) {
            const created = await tx
              .insert(items)
              .values(toInsert.slice(i, i + 500))
              .returning({ id: items.id });
            insertedIds.push(...created.map((row) => row.id));
          }
        });
      }

      // Read the rows back post-commit and hash each column, so the client
      // can prove what landed in the database matches what it sent.
      let columnHashes: ItemColumnHashes | null = null;
      if (insertedIds.length > 0) {
        const inserted = await ctx.db.query.items.findMany({
          where: and(eq(items.businessId, ctx.businessId), inArray(items.id, insertedIds)),
        });
        columnHashes = await hashItemColumns(inserted.map(toItemRow));
      }
      return { importedCount: toInsert.length, skipped, columnHashes };
    }),

  update: businessProcedure
    .input(itemInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...values } = input;
      await assertSkuFree(ctx.db, ctx.businessId, values.sku, id);
      const [updated] = await ctx.db
        .update(items)
        .set(values)
        .where(and(eq(items.id, id), eq(items.businessId, ctx.businessId)))
        .returning({ id: items.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return { id };
    }),

  delete: businessProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const [deleted] = await ctx.db
      .delete(items)
      .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
      .returning({ id: items.id });
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
    return { id: input.id };
  }),
});
