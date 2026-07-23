import { emptyAddress } from "~/app/invoices/_lib/invoice";
import { type Address } from "~/app/invoices/_lib/types";

export interface BusinessSettings {
  businessName: string;
  /** ABN, EIN, VAT number — whatever identifies the business for tax. */
  taxId: string;
  address: Address;
  website: string;
  email: string;
  phone: string;
  /** Logo image as a data URL, printed top-left on invoices; empty for none. */
  logo: string;
  /** Hex colour for invoice headings and rules, e.g. "#1a5276". */
  accentColor: string;
  /** Free text printed on invoices: bank details, PayID, cheque instructions, etc. */
  paymentDetails: string;
  termsAndConditions: string;
  invoiceNumberPrefix: string;
  /**
   * Zero-padded sequence for the next invoice ("000213") — its length sets
   * the padding width of generated numbers. A floor, not a counter: invoice
   * numbers already used under the prefix push past it.
   */
  nextInvoiceNumber: string;
}

/** Numbering defaults mirror the original hardcoded INV-#### scheme. */
export function defaultSettings(): BusinessSettings {
  return {
    businessName: "",
    taxId: "",
    address: emptyAddress(),
    website: "",
    email: "",
    phone: "",
    logo: "",
    accentColor: "#111827",
    paymentDetails: "",
    termsAndConditions: "",
    invoiceNumberPrefix: "INV-",
    nextInvoiceNumber: "0001",
  };
}

/** Sequence part of an invoice number under the given prefix, or null if it doesn't match. */
export function invoiceNumberSequence(prefix: string, invoiceNumber: string): number | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}(\\d+)$`).exec(invoiceNumber.trim());
  return match ? Number(match[1]) : null;
}
