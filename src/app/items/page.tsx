import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { ItemsManager } from "./_components/items-manager";

export const metadata: Metadata = {
  title: "Items",
};

export default async function ItemsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  void api.item.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <ItemsManager />
      </main>
    </HydrateClient>
  );
}
