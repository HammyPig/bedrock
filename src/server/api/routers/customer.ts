import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { type BillTo, type Customer } from "~/app/invoices/_lib/types";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { customers } from "~/server/db/schema";

export const addressInput = z.object({
  line1: z.string().max(255),
  line2: z.string().max(255),
  suburb: z.string().max(255),
  state: z.string().max(64),
  postcode: z.string().max(16),
});

/** Customer details without an id — also the invoice's bill-to snapshot shape. */
export const billToInput = z.object({
  name: z.string().max(255),
  company: z.string().max(255),
  phone: z.string().max(64),
  email: z.string().max(255),
  tier: z.enum(["tier_1", "tier_2", "tier_3", ""]),
  billingAddress: addressInput,
  deliveryAddress: addressInput,
}) satisfies z.ZodType<BillTo>;

/** Comparison key for import duplicate-detection only. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function toCustomer(row: typeof customers.$inferSelect): Customer {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    tier: row.tier,
    billingAddress: row.billingAddress,
    deliveryAddress: row.deliveryAddress,
  };
}

export const customerRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.customers.findMany({
      where: eq(customers.businessId, ctx.businessId),
      orderBy: [asc(customers.name)],
    });
    return rows.map(toCustomer);
  }),

  create: businessProcedure.input(billToInput).mutation(async ({ ctx, input }) => {
    const [created] = await ctx.db
      .insert(customers)
      .values({ ...input, businessId: ctx.businessId })
      .returning({ id: customers.id });
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return { id: created.id };
  }),

  /** CSV import: rows whose name matches an existing customer are skipped and reported. */
  bulkCreate: businessProcedure
    .input(
      z.object({
        customers: z
          .array(billToInput.extend({ name: z.string().min(1).max(255) }))
          .min(1)
          .max(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.businessId, ctx.businessId));
      const inBook = new Set(existing.map((row) => normalizeName(row.name)));

      const skipped: { index: number; reason: string }[] = [];
      const seen = new Set<string>();
      const toInsert: (typeof customers.$inferInsert)[] = [];
      input.customers.forEach((customer, index) => {
        const key = normalizeName(customer.name);
        if (inBook.has(key)) {
          skipped.push({
            index,
            reason: `A customer named ${customer.name.trim()} already exists.`,
          });
          return;
        }
        if (seen.has(key)) {
          skipped.push({
            index,
            reason: `${customer.name.trim()} appears earlier in the file; only the first row was imported.`,
          });
          return;
        }
        seen.add(key);
        toInsert.push({ ...customer, businessId: ctx.businessId });
      });

      if (toInsert.length > 0) {
        await ctx.db.transaction(async (tx) => {
          for (let i = 0; i < toInsert.length; i += 500) {
            await tx.insert(customers).values(toInsert.slice(i, i + 500));
          }
        });
      }
      return { importedCount: toInsert.length, skipped };
    }),

  update: businessProcedure
    .input(z.object({ id: z.string(), details: billToInput }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(customers)
        .set(input.details)
        .where(and(eq(customers.id, input.id), eq(customers.businessId, ctx.businessId)))
        .returning({ id: customers.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
    }),
});
