import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { PurchaseOrderForm } from "../../../_components/purchase-order-form";

interface EditPurchaseOrderPageProps {
  params: Promise<{ purchaseOrderId: string }>;
}

export async function generateMetadata({ params }: EditPurchaseOrderPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Edit purchase order" };
  }

  const { purchaseOrderId } = await params;
  const purchaseOrder = await api.purchaseOrder.get({ id: purchaseOrderId });
  return { title: purchaseOrder ? `Edit ${purchaseOrder.draft.poNumber}` : "Edit purchase order" };
}

export default async function EditPurchaseOrderPage({ params }: EditPurchaseOrderPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  const { purchaseOrderId } = await params;
  const purchaseOrder = await api.purchaseOrder.get({ id: purchaseOrderId });
  if (!purchaseOrder) notFound();

  void api.item.list.prefetch();
  void api.vendor.list.prefetch();

  return (
    <HydrateClient>
      <PurchaseOrderForm initialDraft={purchaseOrder.draft} purchaseOrderId={purchaseOrder.id} />
    </HydrateClient>
  );
}
