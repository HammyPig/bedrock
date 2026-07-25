import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { hashItemColumns, type ItemColumnHashes } from "~/lib/import-verify";
import { loadModules } from "~/server/api/routers/settings";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { items, itemTierPrices, tiers } from "~/server/db/schema";
import { type db as database } from "~/server/db";

const itemInput = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  vendor: z.string().max(256),
  barcode: z.string().max(64),
  unitPriceCents: z.number().int().min(0),
  /** Tier id → price in cents; a $0 entry means "unset" and stores no row. */
  tierPrices: z.record(z.string().max(255), z.number().int().min(0)),
  costCents: z.number().int().min(0),
});

/** Comparison key only — the user's own casing/spacing is never rewritten. */
function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

type ItemRow = typeof items.$inferSelect & {
  tierPrices: (typeof itemTierPrices.$inferSelect)[];
};

function toItemRow(row: ItemRow, tieredPricing: boolean) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    vendor: row.vendor,
    barcode: row.barcode,
    unitPriceCents: row.unitPriceCents,
    // With the module off, tier prices stay out of every read so all pricing
    // paths fall back to the unit price.
    tierPrices: tieredPricing
      ? Object.fromEntries(row.tierPrices.map((price) => [price.tierId, price.priceCents]))
      : {},
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

async function businessTierIds(db: typeof database, businessId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: tiers.id })
    .from(tiers)
    .where(eq(tiers.businessId, businessId));
  return new Set(rows.map((row) => row.id));
}

/** The storable tier price entries: positive prices for tiers this business actually has. */
function storableTierPrices(
  tierPrices: Record<string, number>,
  validTierIds: Set<string>,
): [string, number][] {
  return Object.entries(tierPrices).filter(
    ([tierId, cents]) => cents > 0 && validTierIds.has(tierId),
  );
}

export const itemRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const modules = await loadModules(ctx.db, ctx.businessId);
    const rows = await ctx.db.query.items.findMany({
      where: eq(items.businessId, ctx.businessId),
      orderBy: [asc(items.createdAt), asc(items.id)],
      with: { tierPrices: true },
    });
    return rows.map((row) => toItemRow(row, modules.tieredPricing));
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.items.findFirst({
      where: and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)),
      with: { tierPrices: true },
    });
    if (!row) return null;
    const modules = await loadModules(ctx.db, ctx.businessId);
    return toItemRow(row, modules.tieredPricing);
  }),

  create: businessProcedure.input(itemInput).mutation(async ({ ctx, input }) => {
    const { tierPrices, ...values } = input;
    await assertSkuFree(ctx.db, ctx.businessId, values.sku);
    const modules = await loadModules(ctx.db, ctx.businessId);
    const entries = modules.tieredPricing
      ? storableTierPrices(tierPrices, await businessTierIds(ctx.db, ctx.businessId))
      : [];
    const id = await ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(items)
        .values({ ...values, businessId: ctx.businessId })
        .returning({ id: items.id });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (entries.length > 0) {
        await tx
          .insert(itemTierPrices)
          .values(
            entries.map(([tierId, priceCents]) => ({ itemId: created.id, tierId, priceCents })),
          );
      }
      return created.id;
    });
    return { id };
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
      const tierPricesBySku = new Map<string, Record<string, number>>();
      input.items.forEach((item, index) => {
        const { tierPrices, ...values } = item;
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
        toInsert.push({ ...values, businessId: ctx.businessId });
        tierPricesBySku.set(key, tierPrices);
      });

      const modules = await loadModules(ctx.db, ctx.businessId);
      const validTierIds = modules.tieredPricing
        ? await businessTierIds(ctx.db, ctx.businessId)
        : new Set<string>();

      const insertedIds: string[] = [];
      if (toInsert.length > 0) {
        await ctx.db.transaction(async (tx) => {
          for (let i = 0; i < toInsert.length; i += 500) {
            const created = await tx
              .insert(items)
              .values(toInsert.slice(i, i + 500))
              .returning({ id: items.id, sku: items.sku });
            insertedIds.push(...created.map((row) => row.id));
            // Post-dedup the batch's normalized SKUs are unique, so they key
            // each created row back to its tier prices.
            const priceRows = created.flatMap((row) =>
              storableTierPrices(
                tierPricesBySku.get(normalizeSku(row.sku)) ?? {},
                validTierIds,
              ).map(([tierId, priceCents]) => ({ itemId: row.id, tierId, priceCents })),
            );
            if (priceRows.length > 0) await tx.insert(itemTierPrices).values(priceRows);
          }
        });
      }

      // Read the rows back post-commit and hash each column, so the client
      // can prove what landed in the database matches what it sent.
      let columnHashes: ItemColumnHashes | null = null;
      if (insertedIds.length > 0) {
        const inserted = await ctx.db.query.items.findMany({
          where: and(eq(items.businessId, ctx.businessId), inArray(items.id, insertedIds)),
          with: { tierPrices: true },
        });
        columnHashes = await hashItemColumns(
          inserted.map((row) => toItemRow(row, modules.tieredPricing)),
          [...validTierIds],
        );
      }
      return { importedCount: toInsert.length, skipped, columnHashes };
    }),

  update: businessProcedure
    .input(itemInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, tierPrices, ...values } = input;
      await assertSkuFree(ctx.db, ctx.businessId, values.sku, id);
      const modules = await loadModules(ctx.db, ctx.businessId);
      // With the module off the form never shows tier prices, so leave the
      // stored rows untouched for when it's toggled back on.
      const entries = modules.tieredPricing
        ? storableTierPrices(tierPrices, await businessTierIds(ctx.db, ctx.businessId))
        : null;
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(items)
          .set(values)
          .where(and(eq(items.id, id), eq(items.businessId, ctx.businessId)))
          .returning({ id: items.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        if (entries !== null) {
          await tx.delete(itemTierPrices).where(eq(itemTierPrices.itemId, id));
          if (entries.length > 0) {
            await tx
              .insert(itemTierPrices)
              .values(entries.map(([tierId, priceCents]) => ({ itemId: id, tierId, priceCents })));
          }
        }
      });
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
