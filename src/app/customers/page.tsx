import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { CustomersList } from "./_components/customers-list";

export const metadata: Metadata = {
  title: "Customers",
};

export default async function CustomersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  void api.customer.list.prefetch();
  void api.invoice.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <CustomersList />
      </main>
    </HydrateClient>
  );
}
