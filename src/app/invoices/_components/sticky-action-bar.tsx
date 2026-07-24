"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { formatCents } from "~/lib/money";

interface StickyActionBarProps {
  balanceCents: number;
  autosaveStatus: "idle" | "saving" | "saved";
  saveError?: string;
  exporting: boolean;
  sending: boolean;
  sendError?: string;
  /** Address the invoice was emailed to, shown as confirmation until the next edit. */
  sentTo?: string;
  onSave: () => void;
  onSaveAndExport: () => void;
  onSaveAndEmail: () => void;
}

export function StickyActionBar({
  balanceCents,
  autosaveStatus,
  saveError,
  exporting,
  sending,
  sendError,
  sentTo,
  onSave,
  onSaveAndExport,
  onSaveAndEmail,
}: StickyActionBarProps) {
  const saving = autosaveStatus === "saving";
  const busy = saving || exporting || sending;
  const error = saving || sending ? undefined : (saveError ?? sendError);

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
        <span className="text-muted-foreground text-sm">Balance due</span>
        <span className="font-semibold tabular-nums">{formatCents(balanceCents)}</span>
        <Button variant="outline" disabled={busy} onClick={onSave}>
          Save
        </Button>
        <Button variant="outline" disabled={busy} onClick={onSaveAndExport}>
          {exporting ? "Exporting…" : "Save + export"}
        </Button>
        <Button disabled={busy} onClick={onSaveAndEmail}>
          {sending ? "Sending…" : "Save + email"}
        </Button>
      </div>
    </div>
  );
}
