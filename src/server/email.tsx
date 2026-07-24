import "server-only";

import { TRPCError } from "@trpc/server";
import { Resend } from "resend";

import { customerDisplayName, draftDueDate } from "~/app/invoices/_lib/invoice";
import { computeTotals } from "~/app/invoices/_lib/money";
import { type InvoiceDraft } from "~/app/invoices/_lib/types";
import { type BusinessSettings } from "~/app/settings/_lib/settings";
import { formatIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { env } from "~/env";

/** Fills `{placeholder}` tokens from vars; unknown placeholders pass through untouched. */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => vars[key] ?? token);
}

/** Values for the placeholders listed in EMAIL_TEMPLATE_PLACEHOLDERS. */
function templateVars(draft: InvoiceDraft, settings: BusinessSettings): Record<string, string> {
  const totals = computeTotals(draft);
  return {
    customerName: customerDisplayName(draft.billTo),
    invoiceNumber: draft.invoiceNumber,
    businessName: settings.businessName,
    total: formatCents(totals.totalCents),
    balanceDue: formatCents(totals.balanceCents),
    dueDate: formatIsoDate(draftDueDate(draft)),
  };
}

/** Emails the invoice to `to`, with the rendered PDF attached. */
export async function sendInvoiceEmail(
  to: string,
  draft: InvoiceDraft,
  settings: BusinessSettings,
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Email sending isn't configured — set RESEND_API_KEY and EMAIL_FROM.",
    });
  }

  // The PDF renderer is heavy, so it only loads when an email is sent.
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { InvoicePdf } = await import("~/app/invoices/_lib/invoice-pdf");
  const pdf = await renderToBuffer(<InvoicePdf draft={draft} settings={settings} />);

  const vars = templateVars(draft, settings);
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    // Replies go to the business, not the sending domain.
    replyTo: settings.email.trim() !== "" ? settings.email : undefined,
    subject: renderTemplate(settings.emailSubject, vars),
    text: renderTemplate(settings.emailBody, vars),
    attachments: [
      {
        filename: `${draft.invoiceNumber.trim() || "invoice"}.pdf`,
        content: pdf,
      },
    ],
  });
  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `The email could not be sent: ${error.message}`,
    });
  }
}
