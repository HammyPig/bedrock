import { type Metadata } from "next";

import { InvoiceForm } from "./_components/invoice-form";

export const metadata: Metadata = {
  title: "New invoice",
};

export default function NewInvoicePage() {
  return (
    <main className="bg-background min-h-screen">
      <InvoiceForm />
    </main>
  );
}
