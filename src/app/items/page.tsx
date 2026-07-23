import { type Metadata } from "next";

import { ItemsManager } from "./_components/items-manager";

export const metadata: Metadata = {
  title: "Items",
};

export default function ItemsPage() {
  return (
    <main className="bg-background min-h-screen">
      <ItemsManager />
    </main>
  );
}
