import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api } from "~/trpc/server";
import { ItemForm } from "../../../_components/item-form";

interface EditItemPageProps {
  params: Promise<{ itemId: string }>;
}

export async function generateMetadata({ params }: EditItemPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Edit item" };
  }

  const { itemId } = await params;
  const item = await api.item.get({ id: itemId });
  return { title: item ? `Edit ${item.name}` : "Edit item" };
}

export default async function EditItemPage({ params }: EditItemPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  const { itemId } = await params;
  const item = await api.item.get({ id: itemId });
  if (!item) notFound();

  return <ItemForm initialItem={item} itemId={item.id} />;
}
