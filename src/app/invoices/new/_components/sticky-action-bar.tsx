"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { formatCents } from "~/lib/money";

interface StickyActionBarProps {
  balanceCents: number;
  autosaveStatus: "idle" | "saving" | "saved";
  justSent: boolean;
  onSaveDraft: () => void;
  onSend: () => void;
}

export function StickyActionBar({
  balanceCents,
  autosaveStatus,
  justSent,
  onSaveDraft,
  onSend,
}: StickyActionBarProps) {
  return (
    <div className="bg-card/95 sticky bottom-0 flex items-center justify-between gap-4 rounded-b-xl border-t px-8 py-4 backdrop-blur sm:px-10">
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
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">Balance due</span>
        <span className="font-semibold tabular-nums">{formatCents(balanceCents)}</span>
        <Button variant="outline" onClick={onSaveDraft}>
          Save draft
        </Button>
        <Button onClick={onSend}>{justSent ? "Sent ✓" : "Send"}</Button>
      </div>
    </div>
  );
}
