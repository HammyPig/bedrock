"use client";

import { useState } from "react";

import { AddressField } from "~/app/invoices/_components/address-field";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { EMAIL_TEMPLATE_PLACEHOLDERS, type BusinessSettings } from "../_lib/settings";

const MAX_LOGO_BYTES = 1_000_000;

export interface SettingsFieldsProps {
  value: BusinessSettings;
  onChange: (patch: Partial<BusinessSettings>) => void;
}

/** Name, tax ID, and contact details — the invoice header block. */
export function BusinessDetailsFields({ value, onChange }: SettingsFieldsProps) {
  return (
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
  );
}

/** Everything printed on the invoice PDF: branding, payment details, terms, numbering. */
export function InvoiceAppearanceFields({ value, onChange }: SettingsFieldsProps) {
  const [logoError, setLogoError] = useState<string | null>(null);
  const nextNumberValid = Number(value.nextInvoiceNumber) >= 1;
  const previewNumber = value.invoiceNumberPrefix + value.nextInvoiceNumber;

  const handleLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo images must be 1MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setLogoError(null);
      onChange({ logo: reader.result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <section>
        <h2 className="mb-1 font-medium">Invoice appearance</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Your logo and accent colour, used on every invoice PDF.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="logo">Logo</Label>
            {value.logo !== "" && (
              // eslint-disable-next-line @next/next/no-img-element -- data-URL preview, nothing to optimize
              <img
                src={value.logo}
                alt="Business logo"
                className="h-16 w-auto rounded-md border p-1"
              />
            )}
            <div className="flex items-center gap-3" key={value.logo === "" ? "no-logo" : "logo"}>
              <Input
                id="logo"
                type="file"
                accept="image/*"
                onChange={(e) => handleLogoFile(e.currentTarget.files?.[0])}
              />
              {value.logo !== "" && (
                <Button type="button" variant="outline" onClick={() => onChange({ logo: "" })}>
                  Remove
                </Button>
              )}
            </div>
            {logoError && <p className="text-destructive text-sm">{logoError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="accent-color">Accent colour</Label>
            <div className="flex items-center gap-3">
              <input
                id="accent-color"
                type="color"
                value={value.accentColor}
                onChange={(e) => onChange({ accentColor: e.currentTarget.value })}
                className="border-input h-9 w-14 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <span className="text-muted-foreground text-sm uppercase tabular-nums">
                {value.accentColor}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              Colours the headings and rules on the PDF.
            </p>
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
    </>
  );
}

/** Subject and body templates for the email invoices are sent with. */
export function InvoiceEmailFields({ value, onChange }: SettingsFieldsProps) {
  return (
    <section>
      <h2 className="mb-1 font-medium">Invoice email</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        The email your customers receive when you send them an invoice — the PDF is attached
        automatically. Placeholders are filled in per invoice:{" "}
        {EMAIL_TEMPLATE_PLACEHOLDERS.map((placeholder, i) => (
          <span key={placeholder}>
            {i > 0 && ", "}
            <code className="text-foreground">{`{${placeholder}}`}</code>
          </span>
        ))}
        .
      </p>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email-subject">Subject</Label>
          <Input
            id="email-subject"
            maxLength={255}
            value={value.emailSubject}
            onChange={(e) => onChange({ emailSubject: e.currentTarget.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email-body">Message</Label>
          <Textarea
            id="email-body"
            rows={7}
            value={value.emailBody}
            onChange={(e) => onChange({ emailBody: e.currentTarget.value })}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Every business-settings section at once, for the create-business page,
 * which collects everything in a single form. The settings pages render
 * the sections individually via SettingsForm.
 */
export function SettingsFields(props: SettingsFieldsProps) {
  return (
    <div className="space-y-10 p-8 sm:p-10">
      <BusinessDetailsFields {...props} />
      <InvoiceAppearanceFields {...props} />
      <InvoiceEmailFields {...props} />
    </div>
  );
}
