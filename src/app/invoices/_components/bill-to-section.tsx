"use client";

import { Fragment, useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon, PencilLineIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { fieldMatchesAnyToken, matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import {
  billToHasContent,
  billToMatchesCustomer,
  CUSTOMER_TIER_OPTIONS,
  customerDisplayName,
} from "../_lib/invoice";
import { type BillTo, type Customer, type CustomerTier, type InvoiceAction } from "../_lib/types";
import { AddressField } from "./address-field";
import { Highlight } from "./highlight";

interface BillToSectionProps {
  billTo: BillTo;
  sourceCustomerId: string | null;
  delivery: boolean;
  deliverySameAsBilling: boolean;
  error?: string;
  dispatch: (action: InvoiceAction) => void;
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

export function BillToSection({
  billTo,
  sourceCustomerId,
  delivery,
  deliverySameAsBilling,
  error,
  dispatch,
}: BillToSectionProps) {
  const [customers] = api.customer.list.useSuspenseQuery();
  const utils = api.useUtils();
  const source = customers.find((customer) => customer.id === sourceCustomerId);
  const diverged = source !== undefined && !billToMatchesCustomer(billTo, source);
  const unsaved = source === undefined && billToHasContent(billTo);

  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const timeout = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(timeout);
  }, [flash]);

  const createCustomer = api.customer.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.customer.list.invalidate();
      dispatch({ type: "patch", patch: { sourceCustomerId: id } });
      setFlash("Saved");
    },
  });
  const updateCustomer = api.customer.update.useMutation({
    onSuccess: async () => {
      await utils.customer.list.invalidate();
      setFlash("Updated");
    },
  });

  const handleUpdateSavedCustomer = () => {
    if (sourceCustomerId === null) return;
    updateCustomer.mutate({ id: sourceCustomerId, details: billTo });
  };

  const handleSaveAsNewCustomer = () => createCustomer.mutate(billTo);

  const setField = (field: "name" | "company" | "phone" | "email", value: string) =>
    dispatch({ type: "patchBillTo", patch: { [field]: value } });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>Bill to</Label>
        <div className="flex items-center gap-3">
          {unsaved && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={handleSaveAsNewCustomer}
            >
              Save to customers
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
                <DropdownMenuItem onSelect={handleUpdateSavedCustomer}>
                  Update saved customer
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSaveAsNewCustomer}>
                  Save as new customer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => dispatch({ type: "fillBillToFromCustomer", customer: source })}
                >
                  Reset to saved
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <CustomerPicker
            customers={customers}
            linkedCustomer={source}
            onPick={(customer) => dispatch({ type: "fillBillToFromCustomer", customer })}
          />
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {CONTACT_FIELDS.map(({ field, label, type, invalid }) => (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={`billto-${field}`} className="text-muted-foreground">
              {label}
            </Label>
            <Input
              id={`billto-${field}`}
              type={type}
              value={billTo[field]}
              aria-invalid={invalid ? error !== undefined : undefined}
              onChange={(e) => setField(field, e.currentTarget.value)}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="billto-tier" className="text-muted-foreground">
            Tier
          </Label>
          <Select
            value={billTo.tier}
            onValueChange={(value) =>
              dispatch({ type: "patchBillTo", patch: { tier: value as CustomerTier } })
            }
          >
            <SelectTrigger id="billto-tier" className="w-full">
              <SelectValue placeholder="Select tier" />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_TIER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex h-5 items-center">
            <Label className="text-muted-foreground">Billing address</Label>
          </div>
          <AddressField
            labelPrefix="Billing"
            value={billTo.billingAddress}
            onChange={(address) =>
              dispatch({ type: "patchBillTo", patch: { billingAddress: address } })
            }
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex h-5 items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="delivery"
                checked={delivery}
                onCheckedChange={(checked) =>
                  dispatch({ type: "patch", patch: { delivery: checked === true } })
                }
              />
              <Label htmlFor="delivery" className="text-muted-foreground">
                Delivery address
              </Label>
            </div>
            {delivery && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() =>
                  dispatch({
                    type: "patch",
                    patch: { deliverySameAsBilling: !deliverySameAsBilling },
                  })
                }
              >
                {deliverySameAsBilling ? "Use different address" : "Use billing address"}
              </Button>
            )}
          </div>
          {delivery &&
            (deliverySameAsBilling ? (
              <p className="text-muted-foreground flex h-8 items-center text-sm">
                Same as billing address
              </p>
            ) : (
              <AddressField
                labelPrefix="Delivery"
                value={billTo.deliveryAddress}
                onChange={(address) =>
                  dispatch({ type: "patchBillTo", patch: { deliveryAddress: address } })
                }
              />
            ))}
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}

function CustomerPicker({
  customers,
  linkedCustomer,
  onPick,
}: {
  customers: Customer[];
  linkedCustomer: Customer | undefined;
  onPick: (customer: Customer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  const filtered = customers.filter((customer) =>
    matchesAllTokens([customer.name, customer.company, customer.phone, customer.email], tokens),
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
          {linkedCustomer ? (
            <span className="max-w-48 truncate">{customerDisplayName(linkedCustomer)}</span>
          ) : (
            "Saved customers"
          )}
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search customers..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No customers found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((customer) => {
                  // Second line: company, plus phone/email only when they matched.
                  const secondary = [
                    customer.name.trim() === "" ? "" : customer.company,
                    fieldMatchesAnyToken(customer.phone, tokens) ? customer.phone : "",
                    fieldMatchesAnyToken(customer.email, tokens) ? customer.email : "",
                  ].filter((text) => text.trim() !== "");

                  return (
                    <CommandItem
                      key={customer.id}
                      value={customer.id}
                      data-checked={customer.id === linkedCustomer?.id}
                      onSelect={() => {
                        onPick(customer);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">
                          <Highlight text={customerDisplayName(customer)} tokens={tokens} />
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
