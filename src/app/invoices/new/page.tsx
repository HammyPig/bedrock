import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { GST_RATE_BASIS_POINTS } from "~/app/invoices/_lib/money";
import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { InvoiceForm } from "../_components/invoice-form";

export const metadata: Metadata = {
  title: "New invoice",
};

export default async function NewInvoicePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  // Kicked off before the awaited settings so all three fetches run concurrently.
  void api.item.list.prefetch();
  void api.customer.list.prefetch();

  const settings = await api.settings.get();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <InvoiceForm taxBasisPoints={settings.gstRegistered ? GST_RATE_BASIS_POINTS : 0} />
      </main>
    </HydrateClient>
  );
}
