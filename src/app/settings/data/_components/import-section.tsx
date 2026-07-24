"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";
import {
  autoMapColumns,
  convertCustomerRow,
  convertItemRow,
  CUSTOMER_FIELDS,
  ITEM_FIELDS,
  type ColumnMapping,
  type ImportField,
  type RowConversion,
} from "../_lib/csv-import";

type ImportKind = "items" | "customers";

const KIND_FIELDS: Record<ImportKind, ImportField[]> = {
  items: ITEM_FIELDS,
  customers: CUSTOMER_FIELDS,
};

const NOUNS: Record<ImportKind, [singular: string, plural: string]> = {
  items: ["item", "items"],
  customers: ["customer", "customers"],
};

const UNMAPPED = "__unmapped__";
const SHOWN_PROBLEMS = 10;
/** Matches the bulkCreate input cap on the server. */
const MAX_IMPORT_ROWS = 10000;

interface ParsedFile {
  name: string;
  headers: string[];
  rows: string[][];
}

interface ImportOutcome {
  kind: ImportKind;
  importedCount: number;
  /** Duplicates the server skipped, as CSV line numbers. */
  skipped: { rowNumber: number; reason: string }[];
  /** Rows that failed validation here and were never sent. */
  failed: { rowNumber: number; errors: string[] }[];
}

function countLabel(count: number, kind: ImportKind): string {
  return `${count} ${NOUNS[kind][count === 1 ? 0 : 1]}`;
}

function collectValid<T>(rows: string[][], convert: (row: string[]) => RowConversion<T>): T[] {
  return rows.flatMap((row) => {
    const { value } = convert(row);
    return value === null ? [] : [value];
  });
}

/** CSV upload → column mapping → bulk create, for items and customers. */
export function ImportSection() {
  const [kind, setKind] = useState<ImportKind>("items");
  const [file, setFile] = useState<ParsedFile | null>(null);
  /** Bumped to remount the file input, clearing the browser's chosen-file display. */
  const [fileKey, setFileKey] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const fields = KIND_FIELDS[kind];

  const utils = api.useUtils();
  const importItems = api.item.bulkCreate.useMutation({
    onSuccess: () => utils.item.list.invalidate(),
  });
  const importCustomers = api.customer.bulkCreate.useMutation({
    onSuccess: () => utils.customer.list.invalidate(),
  });
  const importing = importItems.isPending || importCustomers.isPending;
  const importError = importItems.error?.message ?? importCustomers.error?.message;

  const handleFile = (selected: File | undefined) => {
    if (!selected) return;
    setOutcome(null);
    setFile(null);
    setParseError(null);
    Papa.parse<string[]>(selected, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const [headers, ...rows] = result.data;
        if (!headers || rows.length === 0) {
          setParseError("That file has no data — expected a header row followed by data rows.");
          return;
        }
        if (rows.length > MAX_IMPORT_ROWS) {
          setParseError(
            `That file has ${rows.length} rows — imports are limited to ${MAX_IMPORT_ROWS} rows per file. Split it up and import in parts.`,
          );
          return;
        }
        setFile({ name: selected.name, headers, rows });
        setMapping(autoMapColumns(KIND_FIELDS[kind], headers));
      },
      error: (error) => setParseError(error.message),
    });
  };

  const handleKindChange = (next: ImportKind) => {
    setKind(next);
    setOutcome(null);
    if (file) setMapping(autoMapColumns(KIND_FIELDS[next], file.headers));
  };

  const conversions = useMemo<RowConversion<unknown>[]>(() => {
    if (!file) return [];
    const convert = kind === "items" ? convertItemRow : convertCustomerRow;
    return file.rows.map((row) => convert(row, mapping));
  }, [file, kind, mapping]);

  const unmappedRequired = fields.filter((field) => field.required && mapping[field.key] == null);
  const invalidRows = conversions.flatMap((conversion, i) =>
    conversion.errors.length > 0 ? [{ rowNumber: i + 2, errors: conversion.errors }] : [],
  );
  const validCount = conversions.length - invalidRows.length;

  const handleImport = async () => {
    if (!file || unmappedRequired.length > 0 || validCount === 0) return;
    importItems.reset();
    importCustomers.reset();
    // CSV line number of each row that gets sent, so the server's skip
    // reports (indexed into the sent array) point back at the right lines.
    const sentRowNumbers = conversions.flatMap((conversion, i) =>
      conversion.errors.length === 0 ? [i + 2] : [],
    );
    try {
      const result =
        kind === "items"
          ? await importItems.mutateAsync({
              items: collectValid(file.rows, (row) => convertItemRow(row, mapping)),
            })
          : await importCustomers.mutateAsync({
              customers: collectValid(file.rows, (row) => convertCustomerRow(row, mapping)),
            });
      setOutcome({
        kind,
        importedCount: result.importedCount,
        skipped: result.skipped.map((skip) => ({
          rowNumber: sentRowNumbers[skip.index] ?? 0,
          reason: skip.reason,
        })),
        failed: invalidRows,
      });
      setFile(null);
      setFileKey((key) => key + 1);
    } catch {
      // Shown via the mutation's error state below.
    }
  };

  return (
    <section>
      <h2 className="mb-1 font-medium">Import</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Bring items or customers in from a CSV spreadsheet. Upload the file, match its columns to
        the fields here, and import. Existing records are never changed — rows that match one are
        skipped and reported.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="import-kind">What are you importing?</Label>
          <Select value={kind} onValueChange={(value) => handleKindChange(value as ImportKind)}>
            <SelectTrigger id="import-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="items">Items</SelectItem>
              <SelectItem value="customers">Customers</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-file">CSV file</Label>
          <Input
            key={fileKey}
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.currentTarget.files?.[0])}
          />
        </div>
      </div>
      {parseError && <p className="text-destructive mt-2 text-sm">{parseError}</p>}

      {file && (
        <div className="mt-6">
          <h3 className="text-sm font-medium">Match columns</h3>
          <p className="text-muted-foreground mb-3 text-sm">
            Found {file.rows.length} data row{file.rows.length === 1 ? "" : "s"} in {file.name}.
            Pick which CSV column fills each field.
            {kind === "customers" &&
              " Customers without delivery address columns get their billing address as the delivery address."}
          </p>
          <div className="space-y-2">
            {fields.map((field) => {
              const index = mapping[field.key] ?? null;
              const sample = index === null ? "" : (file.rows[0]?.[index] ?? "").trim();
              return (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive"> *</span>}
                  </span>
                  <Select
                    value={index === null ? UNMAPPED : String(index)}
                    onValueChange={(value) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: value === UNMAPPED ? null : Number(value),
                      }))
                    }
                  >
                    <SelectTrigger
                      className="w-full flex-1"
                      aria-label={`CSV column for ${field.label}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNMAPPED}>Not mapped</SelectItem>
                      {file.headers.map((header, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {header.trim() || `Column ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground hidden w-40 shrink-0 truncate text-sm sm:block">
                    {sample}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-6 space-y-3">
            {unmappedRequired.length > 0 ? (
              <p className="text-destructive text-sm">
                Map the required field{unmappedRequired.length === 1 ? "" : "s"}:{" "}
                {unmappedRequired.map((field) => field.label).join(", ")}.
              </p>
            ) : (
              <>
                {invalidRows.length > 0 && (
                  <div className="text-sm">
                    <p className="text-destructive">
                      {invalidRows.length} row{invalidRows.length === 1 ? " has" : "s have"}{" "}
                      problems and won&apos;t be imported:
                    </p>
                    <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5">
                      {invalidRows.slice(0, SHOWN_PROBLEMS).map((row) => (
                        <li key={row.rowNumber}>
                          Row {row.rowNumber}: {row.errors.join(" ")}
                        </li>
                      ))}
                      {invalidRows.length > SHOWN_PROBLEMS && (
                        <li>…and {invalidRows.length - SHOWN_PROBLEMS} more</li>
                      )}
                    </ul>
                  </div>
                )}
                <Button disabled={validCount === 0 || importing} onClick={handleImport}>
                  {importing ? "Importing…" : `Import ${countLabel(validCount, kind)}`}
                </Button>
              </>
            )}
            {importError && <p className="text-destructive text-sm">{importError}</p>}
          </div>
        </div>
      )}

      {outcome && !file && (
        <div className="bg-muted/50 mt-6 rounded-lg border p-4 text-sm">
          <p className="font-medium">Imported {countLabel(outcome.importedCount, outcome.kind)}.</p>
          {(outcome.skipped.length > 0 || outcome.failed.length > 0) && (
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
              {outcome.skipped.slice(0, SHOWN_PROBLEMS).map((skip) => (
                <li key={`skipped-${skip.rowNumber}`}>
                  Row {skip.rowNumber}: {skip.reason}
                </li>
              ))}
              {outcome.skipped.length > SHOWN_PROBLEMS && (
                <li>…and {outcome.skipped.length - SHOWN_PROBLEMS} more skipped rows</li>
              )}
              {outcome.failed.slice(0, SHOWN_PROBLEMS).map((fail) => (
                <li key={`failed-${fail.rowNumber}`}>
                  Row {fail.rowNumber}: {fail.errors.join(" ")} Not imported.
                </li>
              ))}
              {outcome.failed.length > SHOWN_PROBLEMS && (
                <li>…and {outcome.failed.length - SHOWN_PROBLEMS} more rows with problems</li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
