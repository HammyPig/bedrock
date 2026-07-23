"use client";

import { useEffect, useState } from "react";

import { AddressField } from "~/app/invoices/_components/address-field";
import { BackLink } from "~/components/back-link";
import { SaveBar } from "~/components/save-bar";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";
import { type BusinessSettings } from "../_lib/settings";

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
  const previewNumber = settings.invoiceNumberPrefix + settings.nextInvoiceNumber;

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
        <div className="space-y-10 p-8 sm:p-10">
          <section>
            <h2 className="mb-1 font-medium">Business details</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              Shown in the header of every invoice you send.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="business-name">Business name</Label>
                <Input
                  id="business-name"
                  value={settings.businessName}
                  onChange={(e) => patch({ businessName: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax-id">ABN / tax ID</Label>
                <Input
                  id="tax-id"
                  value={settings.taxId}
                  onChange={(e) => patch({ taxId: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={settings.website}
                  onChange={(e) => patch({ website: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={settings.email}
                  onChange={(e) => patch({ email: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={settings.phone}
                  onChange={(e) => patch({ phone: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Address</Label>
                <AddressField
                  labelPrefix="Business"
                  value={settings.address}
                  onChange={(address) => patch({ address })}
                />
              </div>
            </div>
          </section>
          <section>
            <h2 className="mb-1 font-medium">Payment details</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              How customers pay you — bank transfer details, PayID, whatever you use. Printed on
              every invoice.
            </p>
            <Textarea
              rows={4}
              aria-label="Payment details"
              placeholder={"Account name: …\nBSB: …\nAccount number: …"}
              value={settings.paymentDetails}
              onChange={(e) => patch({ paymentDetails: e.currentTarget.value })}
            />
          </section>
          <section>
            <h2 className="mb-1 font-medium">Terms &amp; conditions</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              The fine print at the bottom of each invoice — late fees, warranties, return policy.
            </p>
            <Textarea
              rows={4}
              aria-label="Terms and conditions"
              value={settings.termsAndConditions}
              onChange={(e) => patch({ termsAndConditions: e.currentTarget.value })}
            />
          </section>
          <section>
            <h2 className="mb-1 font-medium">Invoice numbering</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              New invoice numbers are the prefix followed by a running number. Zero-pad the next
              number to set its width — 000213 gives six digits. Numbers already invoiced push it up
              automatically, so duplicates are impossible.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoice-prefix">Prefix</Label>
                <Input
                  id="invoice-prefix"
                  maxLength={16}
                  value={settings.invoiceNumberPrefix}
                  onChange={(e) => patch({ invoiceNumberPrefix: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-next">Next number</Label>
                <Input
                  id="invoice-next"
                  inputMode="numeric"
                  maxLength={20}
                  className="tabular-nums"
                  value={settings.nextInvoiceNumber}
                  onChange={(e) =>
                    patch({ nextInvoiceNumber: e.currentTarget.value.replace(/\D/g, "") })
                  }
                />
              </div>
            </div>
            {nextNumberValid ? (
              <p className="text-muted-foreground mt-3 text-sm">
                Your next invoice will be numbered{" "}
                <span className="text-foreground font-medium tabular-nums">{previewNumber}</span>.
              </p>
            ) : (
              <p className="text-destructive mt-3 text-sm">Next number must be 1 or higher.</p>
            )}
          </section>
        </div>
        <SaveBar
          summary={dirty ? "Unsaved changes" : null}
          justSaved={justSaved}
          saving={saveSettings.isPending}
          saveError={saveSettings.error?.message}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
