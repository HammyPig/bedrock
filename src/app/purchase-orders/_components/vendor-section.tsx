"use client";

import { Fragment, useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon, PencilLineIcon } from "lucide-react";

import { AddressField } from "~/app/invoices/_components/address-field";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { fieldMatchesAnyToken, matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import { vendorDisplayName, vendorHasContent, vendorMatchesSaved } from "../_lib/purchase-order";
import { type PurchaseOrderAction, type Vendor, type VendorDetails } from "../_lib/types";
import { Highlight } from "~/components/highlight";

interface VendorSectionProps {
  vendor: VendorDetails;
  sourceVendorId: string | null;
  error?: string;
  dispatch: (action: PurchaseOrderAction) => void;
}

const CONTACT_FIELDS: {
  field: "name" | "company" | "phone" | "email";
  label: string;
  type?: "tel" | "email";
  /** Name/company feed the "needs a name or company" validation. */
  invalid?: boolean;
}[] = [
  { field: "name", label: "Name", invalid: true },
  { field: "company", label: "Company", invalid: true },
  { field: "phone", label: "Phone", type: "tel" },
  { field: "email", label: "Email", type: "email" },
];

export function VendorSection({ vendor, sourceVendorId, error, dispatch }: VendorSectionProps) {
  const [vendors] = api.vendor.list.useSuspenseQuery();
  const utils = api.useUtils();
  const source = vendors.find((saved) => saved.id === sourceVendorId);
  const diverged = source !== undefined && !vendorMatchesSaved(vendor, source);
  const unsaved = source === undefined && vendorHasContent(vendor);

  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const timeout = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(timeout);
  }, [flash]);

  const createVendor = api.vendor.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.vendor.list.invalidate();
      dispatch({ type: "patch", patch: { sourceVendorId: id } });
      setFlash("Saved");
    },
  });
  const updateVendor = api.vendor.update.useMutation({
    onSuccess: async () => {
      await utils.vendor.list.invalidate();
      setFlash("Updated");
    },
  });

  const handleUpdateSavedVendor = () => {
    if (sourceVendorId === null) return;
    updateVendor.mutate({ id: sourceVendorId, details: vendor });
  };

  const handleSaveAsNewVendor = () => createVendor.mutate(vendor);

  const setField = (field: "name" | "company" | "phone" | "email", value: string) =>
    dispatch({ type: "patchVendor", patch: { [field]: value } });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>Vendor</Label>
        <div className="flex items-center gap-3">
          {unsaved && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={handleSaveAsNewVendor}>
              Save to vendors
            </Button>
          )}
          {flash !== null && !diverged && (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <CheckIcon className="size-3.5" />
              {flash}
            </span>
          )}
          {diverged && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <PencilLineIcon />
                  Edited
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleUpdateSavedVendor}>
                  Update saved vendor
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSaveAsNewVendor}>
                  Save as new vendor
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => dispatch({ type: "fillVendorFromSaved", vendor: source })}
                >
                  Reset to saved
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <VendorPicker
            vendors={vendors}
            linkedVendor={source}
            onPick={(saved) => dispatch({ type: "fillVendorFromSaved", vendor: saved })}
          />
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {CONTACT_FIELDS.map(({ field, label, type, invalid }) => (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={`vendor-${field}`} className="text-muted-foreground">
              {label}
            </Label>
            <Input
              id={`vendor-${field}`}
              type={type}
              value={vendor[field]}
              aria-invalid={invalid ? error !== undefined : undefined}
              onChange={(e) => setField(field, e.currentTarget.value)}
            />
          </div>
        ))}
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex h-5 items-center">
            <Label className="text-muted-foreground">Address</Label>
          </div>
          <AddressField
            labelPrefix="Vendor"
            value={vendor.address}
            onChange={(address) => dispatch({ type: "patchVendor", patch: { address } })}
          />
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}

function VendorPicker({
  vendors,
  linkedVendor,
  onPick,
}: {
  vendors: Vendor[];
  linkedVendor: Vendor | undefined;
  onPick: (vendor: Vendor) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  const filtered = vendors.filter((vendor) =>
    matchesAllTokens([vendor.name, vendor.company, vendor.phone, vendor.email], tokens),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="font-normal"
        >
          {linkedVendor ? (
            <span className="max-w-48 truncate">{vendorDisplayName(linkedVendor)}</span>
          ) : (
            "Saved vendors"
          )}
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search vendors..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No vendors found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((vendor) => {
                  // Second line: company, plus phone/email only when they matched.
                  const secondary = [
                    vendor.name.trim() === "" ? "" : vendor.company,
                    fieldMatchesAnyToken(vendor.phone, tokens) ? vendor.phone : "",
                    fieldMatchesAnyToken(vendor.email, tokens) ? vendor.email : "",
                  ].filter((text) => text.trim() !== "");

                  return (
                    <CommandItem
                      key={vendor.id}
                      value={vendor.id}
                      data-checked={vendor.id === linkedVendor?.id}
                      onSelect={() => {
                        onPick(vendor);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">
                          <Highlight text={vendorDisplayName(vendor)} tokens={tokens} />
                        </span>
                        {secondary.length > 0 && (
                          <span className="text-muted-foreground truncate text-xs">
                            {secondary.map((text, index) => (
                              <Fragment key={text}>
                                {index > 0 && " · "}
                                <Highlight text={text} tokens={tokens} />
                              </Fragment>
                            ))}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
