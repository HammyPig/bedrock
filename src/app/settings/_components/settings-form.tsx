"use client";

import { useEffect, useState } from "react";

import { BackLink } from "~/components/back-link";
import { SaveBar } from "~/components/save-bar";
import { api } from "~/trpc/react";
import { type BusinessSettings } from "../_lib/settings";
import { SettingsFields } from "./settings-fields";
import { UsersSection } from "./users-section";

export function SettingsForm() {
  const [initial] = api.settings.get.useSuspenseQuery();
  const [settings, setSettings] = useState<BusinessSettings>(initial);
  /** Last-saved snapshot, reset to the server's canonical values after each save. */
  const [savedSettings, setSavedSettings] = useState<BusinessSettings>(initial);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  const patch = (p: Partial<BusinessSettings>) => setSettings((prev) => ({ ...prev, ...p }));

  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  const utils = api.useUtils();
  const saveSettings = api.settings.save.useMutation({
    onSuccess: async (fresh) => {
      setSettings(fresh);
      setSavedSettings(fresh);
      setJustSaved(true);
      await utils.settings.get.invalidate();
      // The suggested number on the create page depends on numbering settings.
      await utils.invoice.nextNumber.invalidate();
    },
  });

  const nextNumberValid = Number(settings.nextInvoiceNumber) >= 1;

  const handleSave = () => {
    if (!nextNumberValid) return;
    saveSettings.mutate(settings);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <BackLink href="/">Home</BackLink>
      </div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Your business details and invoice preferences.
      </p>
      <div className="bg-card rounded-xl border shadow-sm">
        <SettingsFields value={settings} onChange={patch} />
        <SaveBar
          summary={dirty ? "Unsaved changes" : null}
          justSaved={justSaved}
          saving={saveSettings.isPending}
          saveError={saveSettings.error?.message}
          onSave={handleSave}
        />
      </div>
      <UsersSection />
    </div>
  );
}
