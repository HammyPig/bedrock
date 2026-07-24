import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { type Vendor, type VendorDetails } from "~/app/purchase-orders/_lib/types";
import { addressInput } from "~/server/api/routers/customer";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { vendors } from "~/server/db/schema";

/** Vendor details without an id — also the purchase order's vendor snapshot shape. */
export const vendorDetailsInput = z.object({
  name: z.string().max(255),
  company: z.string().max(255),
  phone: z.string().max(64),
  email: z.string().max(255),
  address: addressInput,
}) satisfies z.ZodType<VendorDetails>;

function toVendor(row: typeof vendors.$inferSelect): Vendor {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    address: row.address,
  };
}

export const vendorRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.vendors.findMany({
      where: eq(vendors.businessId, ctx.businessId),
      orderBy: [asc(vendors.name)],
    });
    return rows.map(toVendor);
  }),

  get: businessProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.vendors.findFirst({
      where: and(eq(vendors.id, input.id), eq(vendors.businessId, ctx.businessId)),
    });
    return row ? toVendor(row) : null;
  }),

  create: businessProcedure.input(vendorDetailsInput).mutation(async ({ ctx, input }) => {
    const [created] = await ctx.db
      .insert(vendors)
      .values({ ...input, businessId: ctx.businessId })
      .returning({ id: vendors.id });
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return { id: created.id };
  }),

  update: businessProcedure
    .input(z.object({ id: z.string(), details: vendorDetailsInput }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(vendors)
        .set(input.details)
        .where(and(eq(vendors.id, input.id), eq(vendors.businessId, ctx.businessId)))
        .returning({ id: vendors.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  delete: businessProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const [deleted] = await ctx.db
      .delete(vendors)
      .where(and(eq(vendors.id, input.id), eq(vendors.businessId, ctx.businessId)))
      .returning({ id: vendors.id });
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
    return { id: input.id };
  }),
});
