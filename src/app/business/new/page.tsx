import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { CreateBusinessForm } from "./_components/create-business-form";

export const metadata: Metadata = {
  title: "Set up your business",
};

export default async function NewBusinessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (await resolveBusinessId(session.user)) redirect("/");

  return (
    <main className="bg-background min-h-screen">
      <CreateBusinessForm />
    </main>
  );
}
