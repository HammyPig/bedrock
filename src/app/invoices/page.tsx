import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { InvoicesList } from "./_components/invoices-list";

export const metadata: Metadata = {
  title: "Invoices",
};

export default async function InvoicesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  void api.invoice.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <InvoicesList />
      </main>
    </HydrateClient>
  );
}
