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
});
