import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { customerDisplayName } from "~/app/invoices/_lib/invoice";
import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api } from "~/trpc/server";
import { CustomerForm } from "../../../_components/customer-form";

interface EditCustomerPageProps {
  params: Promise<{ customerId: string }>;
}

/** Memoized per request so generateMetadata and the page share one fetch. */
const getCustomer = cache(async (id: string) => api.customer.get({ id }));

export async function generateMetadata({ params }: EditCustomerPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Edit customer" };
  }

  const { customerId } = await params;
  const customer = await getCustomer(customerId);
  return { title: customer ? `Edit ${customerDisplayName(customer)}` : "Edit customer" };
}

export default async function EditCustomerPage({ params }: EditCustomerPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  const { customerId } = await params;
  const customer = await getCustomer(customerId);
  if (!customer) notFound();

  return <CustomerForm initialCustomer={customer} customerId={customer.id} />;
}
