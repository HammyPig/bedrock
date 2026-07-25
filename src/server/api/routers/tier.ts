import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { type Tier } from "~/app/invoices/_lib/types";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { tiers } from "~/server/db/schema";

const tierName = z.string().min(1).max(64);

/** Pricing tiers (Tiered pricing module): the business's named tiers, in display order. */
export const tierRouter = createTRPCRouter({
  list: businessProcedure.query(async ({ ctx }): Promise<Tier[]> => {
    const rows = await ctx.db
      .select({ id: tiers.id, name: tiers.name })
      .from(tiers)
      .where(eq(tiers.businessId, ctx.businessId))
      .orderBy(asc(tiers.position), asc(tiers.id));
    return rows;
  }),

  create: businessProcedure.input(z.object({ name: tierName })).mutation(async ({ ctx, input }) => {
    const positions = await ctx.db
      .select({ position: tiers.position })
      .from(tiers)
      .where(eq(tiers.businessId, ctx.businessId));
    const position = Math.max(0, ...positions.map((row) => row.position)) + 1;
    const [created] = await ctx.db
      .insert(tiers)
      .values({ businessId: ctx.businessId, name: input.name.trim(), position })
      .returning({ id: tiers.id });
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return { id: created.id };
  }),

  rename: businessProcedure
    .input(z.object({ id: z.string(), name: tierName }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(tiers)
        .set({ name: input.name.trim() })
        .where(and(eq(tiers.id, input.id), eq(tiers.businessId, ctx.businessId)))
        .returning({ id: tiers.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: input.id };
    }),

  /** Deleting a tier drops its item prices (cascade) and un-assigns its customers (set null). */
  delete: businessProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const [deleted] = await ctx.db
      .delete(tiers)
      .where(and(eq(tiers.id, input.id), eq(tiers.businessId, ctx.businessId)))
      .returning({ id: tiers.id });
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
    return { id: input.id };
  }),
});
