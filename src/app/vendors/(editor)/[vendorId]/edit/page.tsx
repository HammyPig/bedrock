import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { vendorDisplayName } from "~/app/purchase-orders/_lib/purchase-order";
import { auth } from "~/server/auth";
import { resolveBusinessId } from "~/server/business";
import { api } from "~/trpc/server";
import { VendorForm } from "../../../_components/vendor-form";

interface EditVendorPageProps {
  params: Promise<{ vendorId: string }>;
}

/** Memoized per request so generateMetadata and the page share one fetch. */
const getVendor = cache(async (id: string) => api.vendor.get({ id }));

export async function generateMetadata({ params }: EditVendorPageProps): Promise<Metadata> {
  const session = await auth();
  if (!session?.user || !(await resolveBusinessId(session.user))) {
    return { title: "Edit vendor" };
  }

  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  return { title: vendor ? `Edit ${vendorDisplayName(vendor)}` : "Edit vendor" };
}

export default async function EditVendorPage({ params }: EditVendorPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await resolveBusinessId(session.user))) redirect("/");

  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  if (!vendor) notFound();

  return <VendorForm initialVendor={vendor} vendorId={vendor.id} />;
}
