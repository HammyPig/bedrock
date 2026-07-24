import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { PurchaseOrderForm } from "../_components/purchase-order-form";

export const metadata: Metadata = {
  title: "New purchase order",
};

export default async function NewPurchaseOrderPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  // Kicked off before the awaited nextNumber so all three fetches run concurrently.
  void api.item.list.prefetch();
  void api.vendor.list.prefetch();

  const suggestedPoNumber = await api.purchaseOrder.nextNumber();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <PurchaseOrderForm suggestedPoNumber={suggestedPoNumber} />
      </main>
    </HydrateClient>
  );
}
