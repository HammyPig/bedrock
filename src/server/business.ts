import { asc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { businessInvites, businessUsers } from "~/server/db/schema";

/**
 * The id of the business the user belongs to, or null if they have none.
 * A pending invite matching the user's email is claimed on the spot: the
 * membership row is created (oldest invite wins) and every invite for that
 * email is cleared. Lives outside the routers so both the tRPC middleware
 * and server components can use it without an import cycle through trpc.ts.
 *
 * auth() already joins the membership into the session lookup, so for members
 * this returns straight off the session and only member-less users (the
 * invite-claim path) hit the database here.
 */
export async function resolveBusinessId(user: {
  id: string;
  email?: string | null;
  businessId?: string | null;
}): Promise<string | null> {
  if (user.businessId) return user.businessId;

  const membership = await db.query.businessUsers.findFirst({
    where: eq(businessUsers.userId, user.id),
  });
  if (membership) return membership.businessId;

  const email = user.email?.trim().toLowerCase();
  if (!email) return null;
  const invite = await db.query.businessInvites.findFirst({
    where: eq(businessInvites.email, email),
    orderBy: [asc(businessInvites.createdAt)],
  });
  if (!invite) return null;

  // Page and generateMetadata can resolve concurrently — the second insert
  // must not blow up on the membership primary key.
  await db
    .insert(businessUsers)
    .values({ userId: user.id, businessId: invite.businessId })
    .onConflictDoNothing();
  await db.delete(businessInvites).where(eq(businessInvites.email, email));
  return invite.businessId;
}
