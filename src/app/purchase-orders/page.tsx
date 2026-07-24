import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { PurchaseOrdersList } from "./_components/purchase-orders-list";

export const metadata: Metadata = {
  title: "Purchase orders",
};

export default async function PurchaseOrdersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  void api.purchaseOrder.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <PurchaseOrdersList />
      </main>
    </HydrateClient>
  );
}
