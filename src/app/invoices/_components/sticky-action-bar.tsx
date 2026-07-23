"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { formatCents } from "~/lib/money";

interface StickyActionBarProps {
  balanceCents: number;
  autosaveStatus: "idle" | "saving" | "saved";
  saveError?: string;
  justSent: boolean;
  onSaveDraft: () => void;
  onSend: () => void;
}

export function StickyActionBar({
  balanceCents,
  autosaveStatus,
  saveError,
  justSent,
  onSaveDraft,
  onSend,
}: StickyActionBarProps) {
  const saving = autosaveStatus === "saving";

  return (
    <div className="bg-card/95 sticky bottom-0 flex items-center justify-between gap-4 rounded-b-xl border-t px-8 py-4 backdrop-blur sm:px-10">
      {saveError && !saving ? (
        <p className="text-destructive text-sm">{saveError}</p>
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          {autosaveStatus === "saving" && "Saving…"}
          {autosaveStatus === "saved" && (
            <>
              <CheckIcon className="size-4" />
              Saved
            </>
          )}
          {autosaveStatus === "idle" && "Draft"}
        </p>
      )}
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">Balance due</span>
        <span className="font-semibold tabular-nums">{formatCents(balanceCents)}</span>
        <Button variant="outline" disabled={saving} onClick={onSaveDraft}>
          Save draft
        </Button>
        <Button disabled={saving} onClick={onSend}>
          {justSent ? "Sent ✓" : "Send"}
        </Button>
      </div>
    </div>
  );
}
