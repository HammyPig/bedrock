import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { PurchaseOrderForm } from "../../../_components/purchase-order-form";

interface EditPurchaseOrderPageProps {
  params: Promise<{ purchaseOrderId: string }>;
}

/** Memoized per request so generateMetadata and the page share one fetch. */
const getPurchaseOrder = cache(async (id: string) => api.purchaseOrder.get({ id }));

export async function generateMetadata({ params }: EditPurchaseOrderPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Edit purchase order" };
  }

  const { purchaseOrderId } = await params;
  const purchaseOrder = await getPurchaseOrder(purchaseOrderId);
  return { title: purchaseOrder ? `Edit ${purchaseOrder.draft.poNumber}` : "Edit purchase order" };
}

export default async function EditPurchaseOrderPage({ params }: EditPurchaseOrderPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  // Kicked off before the awaited get so all three fetches run concurrently.
  void api.item.list.prefetch();
  void api.vendor.list.prefetch();

  const { purchaseOrderId } = await params;
  const purchaseOrder = await getPurchaseOrder(purchaseOrderId);
  if (!purchaseOrder) notFound();

  return (
    <HydrateClient>
      <PurchaseOrderForm initialDraft={purchaseOrder.draft} purchaseOrderId={purchaseOrder.id} />
    </HydrateClient>
  );
}
