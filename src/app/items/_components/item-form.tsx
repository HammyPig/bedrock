"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";

import { BackLink } from "~/components/back-link";
import { MoneyInput } from "~/components/money-input";
import { SaveBar } from "~/components/save-bar";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { type SavedItem } from "~/lib/items";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { validateItem } from "../_lib/items";

const EMPTY_ITEM: SavedItem = { sku: "", name: "", unitPriceCents: 0 };

interface ItemFormProps {
  /** Existing item being edited; omitted on the create page. */
  initialItem?: SavedItem;
  /** Database id of the item being edited; omitted on the create page. */
  itemId?: string;
}

export function ItemForm({ initialItem, itemId }: ItemFormProps) {
  const router = useRouter();
  const utils = api.useUtils();

  const [draft, setDraft] = useState<SavedItem>(initialItem ?? EMPTY_ITEM);
  /** Last-saved snapshot; null until a new item is first saved. */
  const [savedItem, setSavedItem] = useState<SavedItem | null>(initialItem ?? null);
  const [showErrors, setShowErrors] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  const createItem = api.item.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.item.list.invalidate();
      router.push(`/items/${id}/edit`);
    },
  });
  const updateItem = api.item.update.useMutation({
    onSuccess: async () => {
      setJustSaved(true);
      await utils.item.list.invalidate();
    },
  });
  const deleteItem = api.item.delete.useMutation({
    onSuccess: async () => {
      await utils.item.list.invalidate();
      router.push("/items");
    },
  });

  const saving = createItem.isPending || updateItem.isPending;
  const saveError = (createItem.error ?? updateItem.error)?.message;

  const errors = showErrors ? validateItem(draft) : null;
  const dirty =
    draft.sku !== savedItem?.sku ||
    draft.name !== savedItem?.name ||
    draft.unitPriceCents !== savedItem?.unitPriceCents;

  const patch = (fields: Partial<SavedItem>) => setDraft((prev) => ({ ...prev, ...fields }));

  const handleSave = () => {
    if (saving) return;
    if (validateItem(draft)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (itemId) {
      updateItem.mutate({ id: itemId, ...draft }, { onSuccess: () => setSavedItem(draft) });
    } else {
      // Create lands on the edit page, which remounts the form in sync with the database.
      createItem.mutate(draft);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* On the edit page the (editor) sidebar already shows this link at xl and up. */}
      <div className={cn("mb-4", initialItem && "xl:hidden")}>
        <BackLink href="/items">All items</BackLink>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {initialItem ? `Edit ${initialItem.name}` : "New item"}
        </h1>
        {itemId && initialItem && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2Icon />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this item?</DialogTitle>
                <DialogDescription>
                  {`“${initialItem.name}” will be removed from your catalog. Invoices that already use it keep their own copy.`}
                </DialogDescription>
              </DialogHeader>
              {deleteItem.error && (
                <p className="text-destructive text-sm">{deleteItem.error.message}</p>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  disabled={deleteItem.isPending}
                  onClick={() => deleteItem.mutate({ id: itemId })}
                >
                  {deleteItem.isPending ? "Deleting…" : "Delete item"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-6 p-8 sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row">
            <section className="space-y-2">
              <Label htmlFor="item-sku">SKU</Label>
              <Input
                id="item-sku"
                className="sm:w-40"
                value={draft.sku}
                placeholder="SKU"
                aria-invalid={Boolean(errors?.sku)}
                onChange={(e) => patch({ sku: e.currentTarget.value })}
              />
            </section>
            <section className="flex-1 space-y-2">
              <Label htmlFor="item-name">Name</Label>
              {/* Item names run long; an auto-growing textarea wraps instead of
                  truncating, so the field gains a line rather than hiding text. */}
              <Textarea
                id="item-name"
                rows={1}
                className="min-h-8 resize-none py-[5px] leading-5"
                value={draft.name}
                placeholder="Item name"
                aria-invalid={Boolean(errors?.name)}
                onChange={(e) => patch({ name: e.currentTarget.value.replace(/\s*\n\s*/g, " ") })}
              />
            </section>
            <section className="space-y-2">
              <Label htmlFor="item-price">Unit price</Label>
              <MoneyInput
                id="item-price"
                className="sm:w-32"
                valueCents={draft.unitPriceCents}
                onValueCentsChange={(unitPriceCents) => patch({ unitPriceCents })}
              />
            </section>
          </div>
          {errors && <p className="text-destructive text-sm">Every item needs a SKU and a name.</p>}
        </div>
        <SaveBar
          summary={dirty ? (itemId ? "Unsaved changes" : "Not saved yet") : null}
          justSaved={justSaved}
          saving={saving}
          saveError={saveError}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
