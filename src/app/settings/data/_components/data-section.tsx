"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { customersCsv, downloadCsv, invoicesCsv, itemsCsv } from "../_lib/csv-export";
import { ImportSection } from "./import-section";

type ExportKind = "items" | "customers" | "invoices";

const EXPORTS: { kind: ExportKind; label: string }[] = [
  { kind: "items", label: "Items" },
  { kind: "customers", label: "Customers" },
  { kind: "invoices", label: "Invoices" },
];

/** The Import & export settings section: CSV downloads plus the import wizard. */
export function DataSection() {
  return (
    <div className="bg-card rounded-xl border shadow-sm">
      <div className="space-y-10 p-8 sm:p-10">
        <ExportFields />
        <ImportSection />
      </div>
    </div>
  );
}

function ExportFields() {
  const utils = api.useUtils();
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (kind: ExportKind) => {
    setExporting(kind);
    setError(null);
    try {
      let csv: string;
      if (kind === "invoices") {
        csv = invoicesCsv(await utils.invoice.list.fetch());
      } else {
        // Tier columns come and go with the Tiered pricing module.
        const modules = await utils.settings.modules.fetch();
        const tiers = modules.tieredPricing ? await utils.tier.list.fetch() : null;
        csv =
          kind === "items"
            ? itemsCsv(await utils.item.list.fetch(), tiers ?? [])
            : customersCsv(await utils.customer.list.fetch(), tiers);
      }
      downloadCsv(`${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch {
      setError("Something went wrong preparing the export — try again.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <section>
      <h2 className="mb-1 font-medium">Export</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Download your data as CSV spreadsheets — open them in Excel or bring them into other
        software. Invoices export one row per line item.
      </p>
      <div className="flex flex-wrap gap-2">
        {EXPORTS.map(({ kind, label }) => (
          <Button
            key={kind}
            variant="outline"
            disabled={exporting !== null}
            onClick={() => handleExport(kind)}
          >
            <DownloadIcon />
            {exporting === kind ? "Exporting…" : label}
          </Button>
        ))}
      </div>
      {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
    </section>
  );
}
