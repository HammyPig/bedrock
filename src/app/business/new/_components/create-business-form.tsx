"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { defaultSettings, type BusinessSettings } from "~/app/settings/_lib/settings";
import { SettingsFields } from "~/app/settings/_components/settings-fields";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

export function CreateBusinessForm() {
  const router = useRouter();
  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings);

  const patch = (p: Partial<BusinessSettings>) => setSettings((prev) => ({ ...prev, ...p }));

  const createBusiness = api.business.create.useMutation({
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
  });

  const nextNumberValid = Number(settings.nextInvoiceNumber) >= 1;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Set up your business</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        These details appear on your invoices. You can change any of them later in settings.
      </p>
      <div className="bg-card rounded-xl border shadow-sm">
        <SettingsFields value={settings} onChange={patch} />
        <div className="bg-card/95 sticky bottom-0 flex items-center justify-between gap-4 rounded-b-xl border-t px-8 py-4 backdrop-blur sm:px-10">
          {createBusiness.error && !createBusiness.isPending ? (
            <p className="text-destructive text-sm">{createBusiness.error.message}</p>
          ) : (
            <p className="text-muted-foreground text-sm">
              {createBusiness.isPending ? "Creating…" : "You'll be the owner of this business."}
            </p>
          )}
          <Button
            disabled={!nextNumberValid || createBusiness.isPending}
            onClick={() => createBusiness.mutate(settings)}
          >
            Create business
          </Button>
        </div>
      </div>
    </div>
  );
}
