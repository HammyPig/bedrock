import { api, HydrateClient } from "~/trpc/server";
import { PurchaseOrderSidebar } from "../_components/purchase-order-sidebar";

/**
 * Sits above the [purchaseOrderId] segment so the sidebar survives order switches
 * (anything at or below a dynamic segment remounts when the param changes).
 */
export default function PurchaseOrderEditorLayout({ children }: { children: React.ReactNode }) {
  void api.purchaseOrder.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background flex min-h-screen justify-center">
        {/* Equal flex-1 gutters keep the form viewport-centred; the sidebar floats centred in the left one. */}
        <div className="hidden min-w-0 flex-1 justify-center xl:flex">
          <PurchaseOrderSidebar />
        </div>
        <div className="w-full max-w-3xl">{children}</div>
        <div className="hidden flex-1 xl:block" />
      </main>
    </HydrateClient>
  );
}
