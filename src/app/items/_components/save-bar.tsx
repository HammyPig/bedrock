"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

interface SaveBarProps {
  editedCount: number;
  addedCount: number;
  deletedCount: number;
  justSaved: boolean;
  saving: boolean;
  saveError?: string;
  onSave: () => void;
}

export function SaveBar({
  editedCount,
  addedCount,
  deletedCount,
  justSaved,
  saving,
  saveError,
  onSave,
}: SaveBarProps) {
  const dirty = editedCount + addedCount + deletedCount > 0;
  const summary = [
    editedCount > 0 && `${editedCount} edited`,
    addedCount > 0 && `${addedCount} added`,
    deletedCount > 0 && `${deletedCount} deleted`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bg-card/95 sticky bottom-0 flex items-center justify-between gap-4 rounded-b-xl border-t px-8 py-4 backdrop-blur sm:px-10">
      {saveError && !saving ? (
        <p className="text-destructive text-sm">{saveError}</p>
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          {saving ? (
            "Saving…"
          ) : dirty ? (
            <>
              <span aria-hidden className="size-2 rounded-full bg-amber-400" />
              {summary}
            </>
          ) : justSaved ? (
            <>
              <CheckIcon className="size-4" />
              Saved
            </>
          ) : (
            "No unsaved changes"
          )}
        </p>
      )}
      <Button disabled={!dirty || saving} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}
