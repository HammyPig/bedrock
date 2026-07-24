import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { CustomerForm } from "../_components/customer-form";

export const metadata: Metadata = {
  title: "New customer",
};

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  return (
    <main className="bg-background min-h-screen">
      <CustomerForm />
    </main>
  );
}
