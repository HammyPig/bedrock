"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { type Tier } from "~/app/invoices/_lib/types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import { api } from "~/trpc/react";

/** The Modules settings section: optional-feature toggles, with tier management under Tiered pricing. */
export function ModulesSection() {
  const utils = api.useUtils();
  const modules = api.settings.modules.useQuery();
  const setModules = api.settings.setModules.useMutation({
    // The flag gates what item reads return, so every cached list is stale after a toggle.
    onSuccess: () => utils.invalidate(),
  });

  const enabled = modules.data?.tieredPricing ?? false;

  return (
    <div className="bg-card rounded-xl border shadow-sm">
      <div className="p-8 sm:p-10">
        <section>
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="font-medium">Tiered pricing</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Charge different customers different prices: name your own tiers, assign customers
                to them, and give items a price per tier. Turning this off hides tiers everywhere
                but keeps everything you&apos;ve set up.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              <Checkbox
                id="module-tiered-pricing"
                checked={enabled}
                disabled={!modules.data || setModules.isPending}
                onCheckedChange={(checked) =>
                  setModules.mutate({ tieredPricing: checked === true })
                }
              />
              <Label htmlFor="module-tiered-pricing">Enabled</Label>
            </div>
          </div>
          {setModules.error && (
            <p className="text-destructive mt-2 text-sm">{setModules.error.message}</p>
          )}
          {enabled && <TierManager />}
        </section>
      </div>
    </div>
  );
}

function TierManager() {
  const utils = api.useUtils();
  const tiers = api.tier.list.useQuery();
  const [newName, setNewName] = useState("");

  const createTier = api.tier.create.useMutation({
    onSuccess: async () => {
      setNewName("");
      await utils.tier.list.invalidate();
    },
  });

  return (
    <div className="mt-6 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Tiers</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Customers in a tier pay its price on items that have one; everything else stays at the
          item&apos;s unit price.
        </p>
      </div>
      {tiers.data?.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tiers yet — add the first one below.</p>
      ) : (
        <div className="space-y-2">
          {(tiers.data ?? []).map((tier) => (
            <TierRow key={tier.id} tier={tier} />
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() === "" || createTier.isPending) return;
          createTier.mutate({ name: newName.trim() });
        }}
      >
        <Input
          value={newName}
          placeholder="New tier name (e.g. Wholesale)"
          className="sm:max-w-64"
          aria-label="New tier name"
          onChange={(e) => setNewName(e.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={newName.trim() === "" || createTier.isPending}
        >
          <PlusIcon />
          {createTier.isPending ? "Adding…" : "Add tier"}
        </Button>
      </form>
      {createTier.error && <p className="text-destructive text-sm">{createTier.error.message}</p>}
    </div>
  );
}

/** One tier: rename inline (commits on blur/Enter), delete behind a confirm dialog. */
function TierRow({ tier }: { tier: Tier }) {
  const utils = api.useUtils();
  const [name, setName] = useState(tier.name);

  const renameTier = api.tier.rename.useMutation({
    onSuccess: () => utils.tier.list.invalidate(),
  });
  const deleteTier = api.tier.delete.useMutation({
    // Deleting cascades into item prices and customer assignments, so refresh everything.
    onSuccess: () => utils.invalidate(),
  });

  const commitRename = () => {
    if (name.trim() === "" || name.trim() === tier.name) {
      setName(tier.name);
      return;
    }
    renameTier.mutate({ id: tier.id, name: name.trim() });
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        className="sm:max-w-64"
        aria-label={`Name of tier ${tier.name}`}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${tier.name}`}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2Icon />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Delete ${tier.name}?`}</DialogTitle>
            <DialogDescription>
              Customers in this tier go back to standard pricing and its item prices are removed.
              Invoices you&apos;ve already created keep their prices.
            </DialogDescription>
          </DialogHeader>
          {deleteTier.error && (
            <p className="text-destructive text-sm">{deleteTier.error.message}</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleteTier.isPending}
              onClick={() => deleteTier.mutate({ id: tier.id })}
            >
              {deleteTier.isPending ? "Deleting…" : "Delete tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {renameTier.error && <p className="text-destructive text-sm">{renameTier.error.message}</p>}
    </div>
  );
}
