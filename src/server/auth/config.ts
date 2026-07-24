import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { db } from "~/server/db";
import { accounts, businessUsers, sessions, users, verificationTokens } from "~/server/db/schema";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      businessId: string | null;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

declare module "next-auth/adapters" {
  // Only populated by our getSessionAndUser override below; other adapter
  // paths (createUser, getUserByEmail, ...) return users without it.
  interface AdapterUser {
    businessId?: string | null;
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
const drizzleAdapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const authConfig = {
  providers: [GoogleProvider],
  adapter: {
    ...drizzleAdapter,
    // Joins the business membership into the session lookup so every auth()
    // resolves user + businessId in one DB round trip. businessUsers.userId is
    // the primary key, so the left join can't fan out into multiple rows.
    async getSessionAndUser(sessionToken) {
      const [row] = await db
        .select({ session: sessions, user: users, businessId: businessUsers.businessId })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .leftJoin(businessUsers, eq(businessUsers.userId, users.id))
        .where(eq(sessions.sessionToken, sessionToken));
      if (!row) return null;
      return { session: row.session, user: { ...row.user, businessId: row.businessId } };
    },
  },
  callbacks: {
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
        businessId: user.businessId ?? null,
      },
    }),
  },
} satisfies NextAuthConfig;
