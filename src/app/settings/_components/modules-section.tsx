"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { type Tier } from "~/app/invoices/_lib/types";
import { type Modules } from "~/app/settings/_lib/settings";
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
    // The flags gate what reads return, so every cached list is stale after a toggle.
    onSuccess: () => utils.invalidate(),
  });

  const current = modules.data;
  const toggle = (module: keyof Modules, enabled: boolean) => {
    if (!current) return;
    setModules.mutate({ ...current, [module]: enabled });
  };

  return (
    <div className="bg-card rounded-xl border shadow-sm">
      <div className="space-y-10 p-8 sm:p-10">
        <ModuleToggle
          id="module-tiered-pricing"
          title="Tiered pricing"
          description="Charge different customers different prices: name your own tiers, assign customers to them, and give items a price per tier. Turning this off hides tiers everywhere but keeps everything you've set up."
          enabled={current?.tieredPricing ?? false}
          disabled={!current || setModules.isPending}
          onChange={(enabled) => toggle("tieredPricing", enabled)}
        >
          <TierManager />
        </ModuleToggle>
        <ModuleToggle
          id="module-line-discounts"
          title="Line discounts"
          description="Take a percentage off individual lines on an invoice, on top of any discount on the invoice as a whole. Turning this off locks invoices with line discounts until you turn it back on; you can still record payments against them, export them and email them."
          enabled={current?.lineDiscounts ?? false}
          disabled={!current || setModules.isPending}
          onChange={(enabled) => toggle("lineDiscounts", enabled)}
        />
        <ModuleToggle
          id="module-backorders"
          title="Backorders"
          description="Mark invoice lines that are billed now but ship later, flagged on the invoice PDF. Turning this off locks invoices with backordered lines until you turn it back on; you can still record payments against them, export them and email them."
          enabled={current?.backorders ?? false}
          disabled={!current || setModules.isPending}
          onChange={(enabled) => toggle("backorders", enabled)}
        />
        <ModuleToggle
          id="module-purchase-orders"
          title="Purchase orders"
          description="Record what you order from your suppliers: raise purchase orders, email them out, and keep a vendor list to raise them against. Turning this off hides purchase orders and vendors but keeps everything you've recorded."
          enabled={current?.purchaseOrders ?? false}
          disabled={!current || setModules.isPending}
          onChange={(enabled) => toggle("purchaseOrders", enabled)}
        />
        {setModules.error && <p className="text-destructive text-sm">{setModules.error.message}</p>}
      </div>
    </div>
  );
}

/** One module: its description and Enabled checkbox, with any settings of its own below when on. */
function ModuleToggle({
  id,
  title,
  description,
  enabled,
  disabled,
  onChange,
  children,
}: {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <Checkbox
            id={id}
            checked={enabled}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label htmlFor={id}>Enabled</Label>
        </div>
      </div>
      {enabled && children}
    </section>
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
