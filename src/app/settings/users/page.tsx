import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { UsersSection } from "../_components/users-section";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  return <UsersSection />;
}
