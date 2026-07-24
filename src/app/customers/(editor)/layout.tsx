import { api, HydrateClient } from "~/trpc/server";
import { CustomerSidebar } from "../_components/customer-sidebar";

/**
 * Sits above the [customerId] segment so the sidebar survives customer switches
 * (anything at or below a dynamic segment remounts when the param changes).
 */
export default function CustomerEditorLayout({ children }: { children: React.ReactNode }) {
  void api.customer.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background flex min-h-screen justify-center">
        {/* Equal flex-1 gutters keep the form viewport-centred; the sidebar floats centred in the left one. */}
        <div className="hidden min-w-0 flex-1 justify-center xl:flex">
          <CustomerSidebar />
        </div>
        <div className="w-full max-w-3xl">{children}</div>
        <div className="hidden flex-1 xl:block" />
      </main>
    </HydrateClient>
  );
}
