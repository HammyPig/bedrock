import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { customerDisplayName } from "~/app/invoices/_lib/invoice";
import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { CustomerProfile } from "../../_components/customer-profile";

interface CustomerPageProps {
  params: Promise<{ customerId: string }>;
}

/** Memoized per request so generateMetadata and the page share one fetch. */
const getCustomer = cache(async (id: string) => api.customer.get({ id }));

export async function generateMetadata({ params }: CustomerPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Customer" };
  }

  const { customerId } = await params;
  const customer = await getCustomer(customerId);
  return { title: customer ? customerDisplayName(customer) : "Customer" };
}

export default async function CustomerPage({ params }: CustomerPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  // Kicked off before the awaited get so both fetches run concurrently.
  void api.invoice.list.prefetch();

  const { customerId } = await params;
  const customer = await getCustomer(customerId);
  if (!customer) notFound();

  return (
    <HydrateClient>
      <CustomerProfile customer={customer} />
    </HydrateClient>
  );
}
