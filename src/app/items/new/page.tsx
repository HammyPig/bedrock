import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { ItemForm } from "../_components/item-form";

export const metadata: Metadata = {
  title: "New item",
};

export default async function NewItemPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  return (
    <main className="bg-background min-h-screen">
      <ItemForm />
    </main>
  );
}
