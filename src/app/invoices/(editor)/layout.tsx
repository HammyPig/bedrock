import { InvoiceSidebar } from "../_components/invoice-sidebar";

/**
 * Sits above the [invoiceId] segment so the sidebar survives invoice switches
 * (anything at or below a dynamic segment remounts when the param changes).
 */
export default function InvoiceEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex min-h-screen justify-center">
      {/* Equal flex-1 gutters keep the form viewport-centred; the sidebar floats centred in the left one. */}
      <div className="hidden min-w-0 flex-1 justify-center xl:flex">
        <InvoiceSidebar />
      </div>
      <div className="w-full max-w-3xl">{children}</div>
      <div className="hidden flex-1 xl:block" />
    </main>
  );
}
