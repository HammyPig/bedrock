import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { InvoiceForm } from "../../../_components/invoice-form";

interface EditInvoicePageProps {
  params: Promise<{ invoiceId: string }>;
}

export async function generateMetadata({ params }: EditInvoicePageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user) return { title: "Edit invoice" };

  const { invoiceId } = await params;
  const invoice = await api.invoice.get({ id: invoiceId });
  return { title: invoice ? `Edit ${invoice.draft.invoiceNumber}` : "Edit invoice" };
}

export default async function EditInvoicePage({ params }: EditInvoicePageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { invoiceId } = await params;
  const invoice = await api.invoice.get({ id: invoiceId });
  if (!invoice) notFound();

  void api.item.list.prefetch();
  void api.customer.list.prefetch();

  return (
    <HydrateClient>
      <InvoiceForm initialDraft={invoice.draft} invoiceId={invoice.id} />
    </HydrateClient>
  );
}
