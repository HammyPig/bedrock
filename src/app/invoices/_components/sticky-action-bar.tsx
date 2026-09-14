"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { formatCents } from "~/lib/money";

interface StickyActionBarProps {
  /** The headline figure: the balance due, or the total while the Payments module is off. */
  amount: { label: string; cents: number };
  autosaveStatus: "idle" | "saving" | "saved";
  saveError?: string;
  /** How many errors are shown against fields above; summarised rather than repeated. */
  errorsAbove: number;
  exporting: boolean;
  sending: boolean;
  sendError?: string;
  /** Address the invoice was emailed to, shown as confirmation until the next edit. */
  sentTo?: string;
  /** The invoice can't be edited, so there's nothing to save — export and email go straight ahead. */
  locked: boolean;
  onSave: () => void;
  onSaveAndExport: () => void;
  onSaveAndEmail: () => void;
}

export function StickyActionBar({
  amount,
  autosaveStatus,
  saveError,
  errorsAbove,
  exporting,
  sending,
  sendError,
  sentTo,
  locked,
  onSave,
  onSaveAndExport,
  onSaveAndEmail,
}: StickyActionBarProps) {
  const saving = autosaveStatus === "saving";
  const busy = saving || exporting || sending;
  // Errors with a field of their own are pointed at; the rest have nowhere else to show.
  // The count only earns its place past one, where it says to keep looking.
  const summary =
    errorsAbove === 0
      ? undefined
      : errorsAbove === 1
        ? "Fix the field above"
        : `Fix ${errorsAbove} fields above`;
  const error = saving || sending ? undefined : (summary ?? saveError ?? sendError);

  return (
    <div className="bg-card/95 sticky bottom-0 flex items-center justify-between gap-4 rounded-b-xl border-t px-8 py-4 backdrop-blur sm:px-10">
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          {autosaveStatus === "saving" && "Saving…"}
          {autosaveStatus === "saved" && (
            <>
              <CheckIcon className="size-4" />
              {sentTo ? `Sent to ${sentTo}` : "Saved"}
            </>
          )}
          {autosaveStatus === "idle" && "Draft"}
        </p>
      )}
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">{amount.label}</span>
        <span className="font-semibold tabular-nums">{formatCents(amount.cents)}</span>
        {!locked && (
          <Button variant="outline" disabled={busy} onClick={onSave}>
            Save
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={onSaveAndExport}>
          {exporting ? "Exporting…" : locked ? "Export" : "Save + export"}
        </Button>
        <Button disabled={busy} onClick={onSaveAndEmail}>
          {sending ? "Sending…" : locked ? "Email" : "Save + email"}
        </Button>
      </div>
    </div>
  );
}
