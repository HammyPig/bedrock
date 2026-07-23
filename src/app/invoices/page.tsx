import { type Metadata } from "next";

import { InvoicesList } from "./_components/invoices-list";

export const metadata: Metadata = {
  title: "Invoices",
};

export default function InvoicesPage() {
  return (
    <main className="bg-background min-h-screen">
      <InvoicesList />
    </main>
  );
}
