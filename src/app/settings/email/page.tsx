import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { SettingsForm } from "../_components/settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function InvoiceEmailPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  return <SettingsForm section="email" />;
}
