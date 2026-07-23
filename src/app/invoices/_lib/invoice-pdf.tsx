import { Document, Font, Image, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";

import { type BusinessSettings } from "~/app/settings/_lib/settings";
import { formatIsoDate } from "~/lib/dates";
import { formatCents } from "~/lib/money";
import { customerDisplayName, deriveDueDate } from "./invoice";
import { computeTotals, lineItemSubtotalCents } from "./money";
import { type Address, type InvoiceDraft } from "./types";

// Wrap whole words to the next line instead of react-pdf's default hyphenated splitting.
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.4,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#6b7280" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  brand: { flexDirection: "row" },
  // No height: the logo stretches to match the business block beside it.
  logo: { width: 96, objectFit: "contain", objectPosition: "left", marginRight: 14 },
  businessBlock: { maxWidth: 280 },
  businessName: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  businessLine: { fontSize: 8, color: "#6b7280" },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  titleNumber: { marginTop: 8 },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  partyBlock: { maxWidth: 220 },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 2 },
  metaLabel: { color: "#6b7280", marginRight: 10 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4,
  },
  colSku: { width: 70, paddingRight: 8 },
  colName: { flex: 1, paddingRight: 8 },
  colQty: { width: 40, textAlign: "right" },
  colUnit: { width: 75, textAlign: "right" },
  colDisc: { width: 45, textAlign: "right" },
  colAmount: { width: 80, textAlign: "right" },
  summary: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  // paddingTop matches the totals rows' paddingVertical so both columns start level.
  summaryLeft: { flex: 1, paddingRight: 24, paddingTop: 2 },
  totals: { width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsRule: { borderTopWidth: 1, borderTopColor: "#111827", marginTop: 2, paddingTop: 4 },
  footerSection: { marginTop: 20 },
  // Auto top margin pushes the terms to the bottom of the page.
  termsSection: { marginTop: "auto", paddingTop: 20 },
  footerText: { color: "#374151" },
});

function addressLines(address: Address): string[] {
  const locality = [address.suburb, address.state, address.postcode]
    .filter((part) => part.trim() !== "")
    .join(" ");
  return [address.line1, address.line2, locality].filter((part) => part.trim() !== "");
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function TotalsRow({
  label,
  value,
  bold,
  ruleColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  ruleColor?: string;
}) {
  const textStyle = bold ? styles.bold : undefined;
  return (
    <View
      style={
        ruleColor
          ? [styles.totalsRow, styles.totalsRule, { borderTopColor: ruleColor }]
          : styles.totalsRow
      }
    >
      <Text style={textStyle}>{label}</Text>
      <Text style={textStyle}>{value}</Text>
    </View>
  );
}

interface InvoicePdfProps {
  draft: InvoiceDraft;
  settings: BusinessSettings;
}

export function InvoicePdf({ draft, settings }: InvoicePdfProps) {
  const totals = computeTotals(draft);
  const dueDate =
    draft.terms === "custom"
      ? (draft.customDueDate ?? draft.issueDate)
      : deriveDueDate(draft.issueDate, draft.terms);
  const items = draft.lineItems.filter((item) => item.name.trim() !== "" || item.sku.trim() !== "");
  const showSku = items.some((item) => item.sku.trim() !== "");
  const showDiscount = items.some((item) => item.discountPercent > 0);
  const businessContact = [settings.phone, settings.email, settings.website].filter(
    (value) => value.trim() !== "",
  );
  const accent = settings.accentColor;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {settings.logo !== "" && (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not a DOM img
              <Image src={settings.logo} style={styles.logo} />
            )}
            <View style={styles.businessBlock}>
              {settings.businessName.trim() !== "" && (
                <Text style={[styles.businessName, { color: accent }]}>
                  {settings.businessName}
                </Text>
              )}
              {addressLines(settings.address).map((line, i) => (
                <Text key={i} style={styles.businessLine}>
                  {line}
                </Text>
              ))}
              {settings.taxId.trim() !== "" && (
                <Text style={styles.businessLine}>ABN {settings.taxId}</Text>
              )}
              {businessContact.map((line, i) => (
                <Text key={i} style={styles.businessLine}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: accent }]}>Tax invoice</Text>
            <Text style={styles.titleNumber}>{draft.invoiceNumber}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyBlock}>
            <Text style={styles.sectionLabel}>Bill to</Text>
            <Text style={styles.bold}>{customerDisplayName(draft.billTo)}</Text>
            {draft.billTo.name.trim() !== "" && draft.billTo.company.trim() !== "" && (
              <Text>{draft.billTo.company}</Text>
            )}
            {addressLines(draft.billTo.billingAddress).map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            {draft.billTo.email.trim() !== "" && (
              <Text style={styles.muted}>{draft.billTo.email}</Text>
            )}
            {draft.billTo.phone.trim() !== "" && (
              <Text style={styles.muted}>{draft.billTo.phone}</Text>
            )}
          </View>
          {draft.delivery && (
            <View style={styles.partyBlock}>
              <Text style={styles.sectionLabel}>Deliver to</Text>
              {draft.deliverySameAsBilling ? (
                <Text>Same as billing address</Text>
              ) : (
                addressLines(draft.billTo.deliveryAddress).map((line, i) => (
                  <Text key={i}>{line}</Text>
                ))
              )}
            </View>
          )}
          <View>
            <MetaRow label="Issue date" value={formatIsoDate(draft.issueDate)} />
            <MetaRow label="Due date" value={formatIsoDate(dueDate)} />
            {draft.poNumber.trim() !== "" && <MetaRow label="PO number" value={draft.poNumber} />}
          </View>
        </View>

        <View style={[styles.tableHeader, { borderBottomColor: accent }]}>
          {showSku && <Text style={[styles.colSku, styles.bold]}>SKU</Text>}
          <Text style={[styles.colName, styles.bold]}>Item</Text>
          <Text style={[styles.colQty, styles.bold]}>Qty</Text>
          <Text style={[styles.colUnit, styles.bold]}>Unit price</Text>
          {showDiscount && <Text style={[styles.colDisc, styles.bold]}>Disc.</Text>}
          <Text style={[styles.colAmount, styles.bold]}>Amount</Text>
        </View>
        {items.map((item) => (
          <View key={item.id} style={styles.tableRow} wrap={false}>
            {showSku && <Text style={styles.colSku}>{item.sku}</Text>}
            <Text style={styles.colName}>{item.name}</Text>
            <Text style={styles.colQty}>{String(item.quantity)}</Text>
            <Text style={styles.colUnit}>{formatCents(item.unitPriceCents)}</Text>
            {showDiscount && (
              <Text style={styles.colDisc}>
                {item.discountPercent > 0 ? `${item.discountPercent}%` : ""}
              </Text>
            )}
            <Text style={styles.colAmount}>{formatCents(lineItemSubtotalCents(item))}</Text>
          </View>
        ))}

        <View style={styles.summary}>
          <View style={styles.summaryLeft}>
            {settings.paymentDetails.trim() !== "" && (
              <>
                <Text style={styles.sectionLabel}>Payment details</Text>
                <Text style={styles.footerText}>{settings.paymentDetails}</Text>
              </>
            )}
          </View>
          <View style={styles.totals}>
            <TotalsRow label="Subtotal" value={formatCents(totals.subtotalCents)} />
            {totals.discountCents > 0 && (
              <TotalsRow
                label={
                  draft.discount?.mode === "percent"
                    ? `Discount (${draft.discount.value}%)`
                    : "Discount"
                }
                value={`-${formatCents(totals.discountCents)}`}
              />
            )}
            {draft.freightCents > 0 && (
              <TotalsRow label="Freight" value={formatCents(draft.freightCents)} />
            )}
            {draft.taxRatePercent > 0 && (
              <TotalsRow
                label={`GST (${draft.taxRatePercent}%)`}
                value={formatCents(totals.taxCents)}
              />
            )}
            <TotalsRow
              label="Total"
              value={formatCents(totals.totalCents)}
              bold
              ruleColor={accent}
            />
            {draft.paidCents > 0 && (
              <>
                <TotalsRow label="Paid" value={`-${formatCents(draft.paidCents)}`} />
                <TotalsRow label="Balance due" value={formatCents(totals.balanceCents)} bold />
              </>
            )}
          </View>
        </View>

        {draft.notes.trim() !== "" && (
          <View style={styles.footerSection}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.footerText}>{draft.notes}</Text>
          </View>
        )}
        {settings.termsAndConditions.trim() !== "" && (
          <View style={styles.termsSection}>
            <Text style={styles.sectionLabel}>Terms & conditions</Text>
            <Text style={styles.footerText}>{settings.termsAndConditions}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function invoicePdfBlob(
  draft: InvoiceDraft,
  settings: BusinessSettings,
): Promise<Blob> {
  return pdf(<InvoicePdf draft={draft} settings={settings} />).toBlob();
}
