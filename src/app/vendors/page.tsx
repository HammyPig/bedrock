import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api, HydrateClient } from "~/trpc/server";
import { VendorsList } from "./_components/vendors-list";

export const metadata: Metadata = {
  title: "Vendors",
};

export default async function VendorsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  void api.vendor.list.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <VendorsList />
      </main>
    </HydrateClient>
  );
}
