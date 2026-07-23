import { type Metadata } from "next";
import { redirect } from "next/navigation";

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

  const suggestedInvoiceNumber = await api.invoice.nextNumber();
  void api.item.list.prefetch();
  void api.customer.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <InvoiceForm suggestedInvoiceNumber={suggestedInvoiceNumber} />
      </main>
    </HydrateClient>
  );
}
