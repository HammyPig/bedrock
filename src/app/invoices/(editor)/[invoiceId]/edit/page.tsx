import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { InvoiceForm } from "../../../_components/invoice-form";
import { mockInvoices } from "../../../_lib/mock-data";

interface EditInvoicePageProps {
  params: Promise<{ invoiceId: string }>;
}

export async function generateMetadata({ params }: EditInvoicePageProps): Promise<Metadata> {
  const { invoiceId } = await params;
  const invoice = mockInvoices.find((candidate) => candidate.id === invoiceId);
  return { title: invoice ? `Edit ${invoice.draft.invoiceNumber}` : "Edit invoice" };
}

export default async function EditInvoicePage({ params }: EditInvoicePageProps) {
  const { invoiceId } = await params;
  const invoice = mockInvoices.find((candidate) => candidate.id === invoiceId);
  if (!invoice) notFound();

  return <InvoiceForm initialDraft={invoice.draft} />;
}
