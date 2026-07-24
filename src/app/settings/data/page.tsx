import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { DataSection } from "./_components/data-section";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function DataPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  return <DataSection />;
}
