"use client";

import { useEffect, useState, type ComponentType } from "react";

import { SaveBar } from "~/components/save-bar";
import { api } from "~/trpc/react";
import { type BusinessSettings } from "../_lib/settings";
import {
  BusinessDetailsFields,
  InvoiceAppearanceFields,
  InvoiceEmailFields,
  type SettingsFieldsProps,
} from "./settings-fields";

const SECTION_FIELDS = {
  business: BusinessDetailsFields,
  appearance: InvoiceAppearanceFields,
  email: InvoiceEmailFields,
} satisfies Record<string, ComponentType<SettingsFieldsProps>>;

export type SettingsSection = keyof typeof SECTION_FIELDS;

/**
 * One settings sub-page's card: its sections plus the save bar. Every page
 * edits the full settings object and saves it whole — fields that live on
 * other pages ride along unchanged from the last-loaded values.
 */
export function SettingsForm({ section }: { section: SettingsSection }) {
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

  const Fields = SECTION_FIELDS[section];

  return (
    <div className="bg-card rounded-xl border shadow-sm">
      <div className="space-y-10 p-8 sm:p-10">
        <Fields value={settings} onChange={patch} />
      </div>
      <SaveBar
        summary={dirty ? "Unsaved changes" : null}
        justSaved={justSaved}
        saving={saveSettings.isPending}
        saveError={saveSettings.error?.message}
        onSave={handleSave}
      />
    </div>
  );
}
