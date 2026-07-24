import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { DEFAULT_SETTINGS_PAGE } from "./_lib/sections";

/** The settings sections live on their own sub-pages; this lands on the first. */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  redirect(DEFAULT_SETTINGS_PAGE);
}
