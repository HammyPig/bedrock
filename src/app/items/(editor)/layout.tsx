import { api, HydrateClient } from "~/trpc/server";
import { ItemSidebar } from "../_components/item-sidebar";

/**
 * Sits above the [itemId] segment so the sidebar survives item switches
 * (anything at or below a dynamic segment remounts when the param changes).
 */
export default function ItemEditorLayout({ children }: { children: React.ReactNode }) {
  void api.item.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background flex min-h-screen justify-center">
        {/* Equal flex-1 gutters keep the form viewport-centred; the sidebar floats centred in the left one. */}
        <div className="hidden min-w-0 flex-1 justify-center xl:flex">
          <ItemSidebar />
        </div>
        <div className="w-full max-w-3xl">{children}</div>
        <div className="hidden flex-1 xl:block" />
      </main>
    </HydrateClient>
  );
}
