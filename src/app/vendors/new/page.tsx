import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api } from "~/trpc/server";
import { VendorForm } from "../_components/vendor-form";

export const metadata: Metadata = {
  title: "New vendor",
};

export default async function NewVendorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");
  if (!(await api.settings.modules()).purchaseOrders) redirect("/");

  return (
    <main className="bg-background min-h-screen">
      <VendorForm />
    </main>
  );
}
