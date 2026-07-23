import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { SettingsForm } from "./_components/settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  void api.settings.get.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background min-h-screen">
        <SettingsForm />
      </main>
    </HydrateClient>
  );
}
