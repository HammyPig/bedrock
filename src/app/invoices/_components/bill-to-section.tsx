"use client";

import { Fragment, useState } from "react";
import { ChevronsUpDownIcon, PencilLineIcon, PlusIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { TierSelect } from "~/components/tier-select";
import { fieldMatchesAnyToken, matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import {
  addressesEqual,
  billToHasContent,
  customerDisplayName,
  emptyBillTo,
  formatAddressOneLine,
} from "../_lib/invoice";
import { type BillTo, type Customer, type InvoiceAction } from "../_lib/types";
import { AddressField } from "./address-field";
import { Highlight } from "~/components/highlight";

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

/**
 * Every invoice bills a saved customer. The section starts as a search, shows
 * the picked customer read-only (like their profile), and Edit opens the
 * customer's own fields — saving updates the record and this invoice's copy
 * together. Invoices whose customer was since deleted keep their snapshot;
 * editing one saves it as a new customer.
 */
export function BillToSection({
  billTo,
  sourceCustomerId,
  delivery,
  deliverySameAsBilling,
  error,
  dispatch,
}: BillToSectionProps) {
  const [customers] = api.customer.list.useSuspenseQuery();
  const modules = api.settings.modules.useQuery();
  const tiers = api.tier.list.useQuery(undefined, {
    enabled: modules.data?.tieredPricing === true,
  });
  const utils = api.useUtils();
  const source = customers.find((customer) => customer.id === sourceCustomerId);
  const selected = source !== undefined || billToHasContent(billTo);

  /**
   * The customer fields under edit (null while viewing), and which customer Save
   * updates — null creates a new one. Committed to the draft only on save.
   */
  const [editing, setEditing] = useState<{ fields: BillTo; customerId: string | null } | null>(
    null,
  );
  const [showEditErrors, setShowEditErrors] = useState(false);

  const createCustomer = api.customer.create.useMutation({
    onSuccess: async ({ id }, details) => {
      await utils.customer.list.invalidate();
      dispatch({ type: "fillBillToFromCustomer", customer: { id, ...details } });
      setEditing(null);
    },
  });
  const updateCustomer = api.customer.update.useMutation({
    onSuccess: async (_, { id, details }) => {
      await utils.customer.list.invalidate();
      dispatch({ type: "fillBillToFromCustomer", customer: { id, ...details } });
      setEditing(null);
    },
  });
  const saving = createCustomer.isPending || updateCustomer.isPending;
  const saveError = (createCustomer.error ?? updateCustomer.error)?.message;

  const startEditing = (fields: BillTo, customerId: string | null) => {
    createCustomer.reset();
    updateCustomer.reset();
    setShowEditErrors(false);
    setEditing({ fields, customerId });
  };
  const missingIdentity =
    editing !== null && editing.fields.name.trim() === "" && editing.fields.company.trim() === "";
  const editError =
    showEditErrors && missingIdentity ? "Every customer needs a name or company." : null;

  const handleSave = () => {
    if (editing === null || saving) return;
    if (missingIdentity) {
      setShowEditErrors(true);
      return;
    }
    if (editing.customerId !== null) {
      updateCustomer.mutate({ id: editing.customerId, details: editing.fields });
    } else {
      createCustomer.mutate(editing.fields);
    }
  };

  const patch = (fields: Partial<BillTo>) =>
    setEditing((prev) => prev && { ...prev, fields: { ...prev.fields, ...fields } });

  const tierName =
    billTo.tierId === null
      ? ""
      : (tiers.data?.find((tier) => tier.id === billTo.tierId)?.name ?? "");
  const details: { label: string; value: string }[] = [
    { label: "Name", value: billTo.name },
    { label: "Company", value: billTo.company },
    { label: "Phone", value: billTo.phone },
    { label: "Email", value: billTo.email },
    ...(modules.data?.tieredPricing ? [{ label: "Tier", value: tierName }] : []),
  ];

  return (
    <section className="space-y-3">
      <div className="flex h-8 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Label>Bill to</Label>
          {editing === null && selected && (
            <CustomerPicker
              customers={customers}
              linkedCustomer={source}
              onPick={(customer) => dispatch({ type: "fillBillToFromCustomer", customer })}
              onCreate={(name) => startEditing({ ...emptyBillTo(), name }, null)}
            />
          )}
        </div>
        {editing === null && selected && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => startEditing(billTo, source?.id ?? null)}
          >
            <PencilLineIcon />
            Edit
          </Button>
        )}
      </div>

      {editing !== null ? (
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {CONTACT_FIELDS.map(({ field, label, type, invalid }) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`billto-${field}`} className="text-muted-foreground">
                  {label}
                </Label>
                <Input
                  id={`billto-${field}`}
                  type={type}
                  value={editing.fields[field]}
                  aria-invalid={invalid ? editError !== null : undefined}
                  onChange={(e) => patch({ [field]: e.currentTarget.value })}
                />
              </div>
            ))}
            {modules.data?.tieredPricing && (
              <div className="space-y-1.5">
                <Label htmlFor="billto-tier" className="text-muted-foreground">
                  Tier
                </Label>
                <TierSelect
                  id="billto-tier"
                  value={editing.fields.tierId}
                  onChange={(tierId) => patch({ tierId })}
                />
              </div>
            )}
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Billing address</Label>
              <AddressField
                labelPrefix="Billing"
                value={editing.fields.billingAddress}
                onChange={(billingAddress) => patch({ billingAddress })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Delivery address</Label>
              <AddressField
                labelPrefix="Delivery"
                value={editing.fields.deliveryAddress}
                onChange={(deliveryAddress) => patch({ deliveryAddress })}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            {(editError ?? saveError) && (
              <p className="text-destructive mr-auto text-sm">{editError ?? saveError}</p>
            )}
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : selected ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {details.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-sm">{value.trim() === "" ? "—" : value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground text-xs">Billing address</dt>
            <dd className="text-sm">{formatAddressOneLine(billTo.billingAddress) || "—"}</dd>
          </div>
          {/* Delivery is the order's, not the customer's: seeded from their saved address, edited here. */}
          <div className="space-y-1.5">
            <dt className="flex h-4 items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="delivery"
                  checked={delivery}
                  onCheckedChange={(checked) =>
                    dispatch({ type: "patch", patch: { delivery: checked === true } })
                  }
                />
                <Label htmlFor="delivery" className="text-muted-foreground text-xs">
                  Delivery address
                </Label>
              </div>
              {delivery && (
                <div className="flex items-center gap-3">
                  {!deliverySameAsBilling &&
                    source !== undefined &&
                    !addressesEqual(billTo.deliveryAddress, source.deliveryAddress) && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() =>
                          dispatch({ type: "setDeliveryAddress", address: source.deliveryAddress })
                        }
                      >
                        Use saved address
                      </Button>
                    )}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      dispatch({
                        type: "patch",
                        patch: { deliverySameAsBilling: !deliverySameAsBilling },
                      })
                    }
                  >
                    {deliverySameAsBilling ? "Use different address" : "Use billing address"}
                  </Button>
                </div>
              )}
            </dt>
            {delivery && (
              <dd>
                {deliverySameAsBilling ? (
                  <p className="text-sm">Same as billing address</p>
                ) : (
                  <AddressField
                    labelPrefix="Delivery"
                    value={billTo.deliveryAddress}
                    onChange={(address) => dispatch({ type: "setDeliveryAddress", address })}
                  />
                )}
              </dd>
            )}
          </div>
        </dl>
      ) : (
        <CustomerPicker
          search
          customers={customers}
          linkedCustomer={undefined}
          onPick={(customer) => dispatch({ type: "fillBillToFromCustomer", customer })}
          onCreate={(name) => startEditing({ ...emptyBillTo(), name }, null)}
        />
      )}
      {error && editing === null && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}

function CustomerPicker({
  customers,
  linkedCustomer,
  onPick,
  onCreate,
  search = false,
}: {
  customers: Customer[];
  linkedCustomer: Customer | undefined;
  onPick: (customer: Customer) => void;
  /** "New customer" was chosen; receives the search text as a starting name. */
  onCreate: (name: string) => void;
  /** Render as a full-width search bar (the empty state) instead of a compact switcher. */
  search?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tokens = tokenize(query);

  const filtered = customers.filter((customer) =>
    matchesAllTokens([customer.name, customer.company, customer.phone, customer.email], tokens),
  );

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {search ? (
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="text-muted-foreground w-full justify-start font-normal"
          >
            <SearchIcon />
            Search customers...
          </Button>
        ) : (
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
        )}
      </PopoverTrigger>
      <PopoverContent
        className={search ? "w-(--radix-popover-trigger-width) p-1" : "w-72 p-1"}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search customers..." value={query} onValueChange={setQuery} />
          <CommandList>
            {filtered.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-sm">No customers found.</p>
            )}
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
                        close();
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
            <CommandGroup className="border-t">
              <CommandItem
                value="new-customer"
                onSelect={() => {
                  onCreate(query.trim());
                  close();
                }}
              >
                <PlusIcon />
                New customer{query.trim() !== "" && ` “${query.trim()}”`}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
