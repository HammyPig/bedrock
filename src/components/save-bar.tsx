"use client";

import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

interface SaveBarProps {
  /** Description of the unsaved changes; null when there are none (disables Save). */
  summary: string | null;
  justSaved: boolean;
  saving: boolean;
  saveError?: string;
  /** Where Cancel goes; omitted when the page has no natural place to return to. */
  cancelHref?: string;
  onSave: () => void;
}

/** Sticky footer for card-style editor pages: change summary, save state, Save button. */
export function SaveBar({
  summary,
  justSaved,
  saving,
  saveError,
  cancelHref,
  onSave,
}: SaveBarProps) {
  const dirty = summary !== null;

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
      <div className="flex items-center gap-3">
        {cancelHref && (
          <Button asChild variant="outline">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        )}
        <Button disabled={!dirty || saving} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
