import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";

/** The settings sections live on their own sub-pages; business details is the first. */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  redirect("/settings/business");
}
