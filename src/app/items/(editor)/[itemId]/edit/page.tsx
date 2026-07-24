import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api } from "~/trpc/server";
import { ItemForm } from "../../../_components/item-form";

interface EditItemPageProps {
  params: Promise<{ itemId: string }>;
}

/** Memoized per request so generateMetadata and the page share one fetch. */
const getItem = cache(async (id: string) => api.item.get({ id }));

export async function generateMetadata({ params }: EditItemPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Edit item" };
  }

  const { itemId } = await params;
  const item = await getItem(itemId);
  return { title: item ? `Edit ${item.name}` : "Edit item" };
}

export default async function EditItemPage({ params }: EditItemPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  const { itemId } = await params;
  const item = await getItem(itemId);
  if (!item) notFound();

  return <ItemForm initialItem={item} itemId={item.id} />;
}
