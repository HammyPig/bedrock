"use client";

import { AddressField } from "~/app/invoices/_components/address-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { type BusinessSettings } from "../_lib/settings";

interface SettingsFieldsProps {
  value: BusinessSettings;
  onChange: (patch: Partial<BusinessSettings>) => void;
}

/**
 * The business-settings sections, shared between the settings page and the
 * create-business page. The parent owns the state and the save/create action.
 */
export function SettingsFields({ value, onChange }: SettingsFieldsProps) {
  const nextNumberValid = Number(value.nextInvoiceNumber) >= 1;
  const previewNumber = value.invoiceNumberPrefix + value.nextInvoiceNumber;

  return (
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
              value={value.businessName}
              onChange={(e) => onChange({ businessName: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-id">ABN / tax ID</Label>
            <Input
              id="tax-id"
              value={value.taxId}
              onChange={(e) => onChange({ taxId: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={value.website}
              onChange={(e) => onChange({ website: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={value.email}
              onChange={(e) => onChange({ email: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={value.phone}
              onChange={(e) => onChange({ phone: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Address</Label>
            <AddressField
              labelPrefix="Business"
              value={value.address}
              onChange={(address) => onChange({ address })}
            />
          </div>
        </div>
      </section>
      <section>
        <h2 className="mb-1 font-medium">Payment details</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          How customers pay you — bank transfer details, PayID, whatever you use. Printed on every
          invoice.
        </p>
        <Textarea
          rows={4}
          aria-label="Payment details"
          placeholder={"Account name: …\nBSB: …\nAccount number: …"}
          value={value.paymentDetails}
          onChange={(e) => onChange({ paymentDetails: e.currentTarget.value })}
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
          value={value.termsAndConditions}
          onChange={(e) => onChange({ termsAndConditions: e.currentTarget.value })}
        />
      </section>
      <section>
        <h2 className="mb-1 font-medium">Invoice numbering</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          New invoice numbers are the prefix followed by a running number. Zero-pad the next number
          to set its width — 000213 gives six digits. Numbers already invoiced push it up
          automatically, so duplicates are impossible.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoice-prefix">Prefix</Label>
            <Input
              id="invoice-prefix"
              maxLength={16}
              value={value.invoiceNumberPrefix}
              onChange={(e) => onChange({ invoiceNumberPrefix: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-next">Next number</Label>
            <Input
              id="invoice-next"
              inputMode="numeric"
              maxLength={20}
              className="tabular-nums"
              value={value.nextInvoiceNumber}
              onChange={(e) =>
                onChange({ nextInvoiceNumber: e.currentTarget.value.replace(/\D/g, "") })
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
  );
}
