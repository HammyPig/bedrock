import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { settingsInput } from "~/server/api/routers/settings";
import { businessProcedure, createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { resolveBusinessId } from "~/server/business";
import {
  businesses,
  businessInvites,
  businessSettings,
  businessUsers,
  users,
} from "~/server/db/schema";

export const businessRouter = createTRPCRouter({
  /**
   * Creates the business, records the caller as its owner and first member,
   * and stores the submitted details as its settings.
   */
  create: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    if (await resolveBusinessId(ctx.session.user)) {
      throw new TRPCError({ code: "CONFLICT", message: "You already belong to a business." });
    }

    await ctx.db.transaction(async (tx) => {
      const [business] = await tx
        .insert(businesses)
        .values({ ownerUserId: userId })
        .returning({ id: businesses.id });
      if (!business) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx.insert(businessUsers).values({ userId, businessId: business.id });
      await tx.insert(businessSettings).values({ ...input, businessId: business.id });
    });
  }),

  /** Current users of the business plus pending invites, for the settings page. */
  users: businessProcedure.query(async ({ ctx }) => {
    const business = await ctx.db.query.businesses.findFirst({
      where: eq(businesses.id, ctx.businessId),
    });
    const userRows = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(businessUsers)
      .innerJoin(users, eq(businessUsers.userId, users.id))
      .where(eq(businessUsers.businessId, ctx.businessId))
      .orderBy(asc(businessUsers.createdAt));
    const inviteRows = await ctx.db.query.businessInvites.findMany({
      where: eq(businessInvites.businessId, ctx.businessId),
      orderBy: [asc(businessInvites.createdAt)],
    });
    return {
      users: userRows.map((row) => ({
        ...row,
        isOwner: row.id === business?.ownerUserId,
      })),
      invites: inviteRows.map((row) => ({ id: row.id, email: row.email })),
    };
  }),

  /**
   * Records an invite for an email address. There's no email sending — the
   * invitee is attached automatically the next time they use the app signed
   * in with a matching address.
   */
  invite: businessProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email.") }))
    .mutation(async ({ ctx, input }) => {
      const userRows = await ctx.db
        .select({ email: users.email })
        .from(businessUsers)
        .innerJoin(users, eq(businessUsers.userId, users.id))
        .where(eq(businessUsers.businessId, ctx.businessId));
      if (userRows.some((row) => row.email.toLowerCase() === input.email)) {
        throw new TRPCError({ code: "CONFLICT", message: "That person already has access." });
      }
      await ctx.db
        .insert(businessInvites)
        .values({ businessId: ctx.businessId, email: input.email })
        .onConflictDoNothing();
    }),

  /** Withdraws a pending invite. */
  uninvite: businessProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(businessInvites)
        .where(
          and(eq(businessInvites.id, input.id), eq(businessInvites.businessId, ctx.businessId)),
        );
    }),
});
