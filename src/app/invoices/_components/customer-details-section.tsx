"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  PencilLineIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Command,
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
import { TierSelect } from "~/components/tier-select";
import { fieldMatchesAnyToken, matchesAllTokens, tokenize } from "~/lib/search";
import { api } from "~/trpc/react";
import {
  customerDetailsHasContent,
  customerDetailsMatchesCustomer,
  customerDisplayName,
  emptyCustomerDetails,
} from "../_lib/invoice";
import { type Customer, type CustomerDetails, type InvoiceAction } from "../_lib/types";
import { AddressField } from "./address-field";
import { Highlight } from "~/components/highlight";

interface CustomerDetailsSectionProps {
  customerDetails: CustomerDetails;
  customerId: string | null;
  /** "New customer" was chosen: these fields describe a record that does not exist yet. */
  creating: boolean;
  hasDeliveryAddress: boolean;
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

/** Digits, spaces and the punctuation a phone number is written with. */
const PHONE_LIKE = /^[\d\s+()-]+$/;

/**
 * Which field the customer search text belongs in. Only a confident match is
 * routed: anything that could be a name is one, because a wrong guess sits in a
 * field the user is already looking at, and a clever wrong guess does not.
 */
function fieldForQuery(query: string): "name" | "phone" | "email" {
  if (query.includes("@")) return "email";
  if (PHONE_LIKE.test(query) && /\d/.test(query)) return "phone";
  return "name";
}

export function CustomerDetailsSection({
  customerDetails,
  customerId,
  creating,
  hasDeliveryAddress,
  deliverySameAsBilling,
  error,
  dispatch,
}: CustomerDetailsSectionProps) {
  const [customers] = api.customer.list.useSuspenseQuery();
  const modules = api.settings.modules.useQuery();
  const utils = api.useUtils();
  const source = customers.find((customer) => customer.id === customerId);
  // `creating` carries the case where "New customer" was chosen but nothing has
  // been typed yet, so there is no content to go by.
  const showFields = source !== undefined || customerDetailsHasContent(customerDetails) || creating;
  const diverged = source !== undefined && !customerDetailsMatchesCustomer(customerDetails, source);

  /** The field to put the caret in once the fields it belongs to have rendered. */
  const [focusField, setFocusField] = useState<string | null>(null);
  useEffect(() => {
    if (focusField === null) return;
    document.getElementById(`billto-${focusField}`)?.focus();
    setFocusField(null);
  }, [focusField]);

  /** Brief confirmation that an edit reached the customer's own record. */
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (!updated) return;
    const timeout = setTimeout(() => setUpdated(false), 2500);
    return () => clearTimeout(timeout);
  }, [updated]);

  const updateCustomer = api.customer.update.useMutation({
    onSuccess: async () => {
      await utils.customer.list.invalidate();
      setUpdated(true);
    },
  });

  const handleUpdateSavedCustomer = () => {
    if (customerId === null) return;
    updateCustomer.mutate({ id: customerId, details: customerDetails });
  };

  const handleCreateNew = (query: string) => {
    const field = fieldForQuery(query);
    dispatch({
      type: "startNewCustomer",
      customerDetails: { ...emptyCustomerDetails(), [field]: query },
    });
    setFocusField(field);
  };

  const handlePickCustomer = (customer: Customer) => {
    dispatch({ type: "fillDetailsFromCustomer", customer });
  };

  const setField = (field: "name" | "company" | "phone" | "email", value: string) =>
    dispatch({ type: "patchCustomerDetails", patch: { [field]: value } });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Label>Bill to</Label>
          {showFields && (
            <CustomerPicker
              customers={customers}
              linkedCustomer={source}
              unlinkedLabel={creating ? "New customer" : "Saved customers"}
              onPick={handlePickCustomer}
              onCreate={handleCreateNew}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {updated && !diverged && (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <CheckIcon className="size-3.5" />
              Updated
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => handlePickCustomer(source)}>
                  Reset to saved
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {showFields ? (
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
                  value={customerDetails[field]}
                  aria-invalid={invalid ? error !== undefined : undefined}
                  onChange={(e) => setField(field, e.currentTarget.value)}
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
                  value={customerDetails.tierId}
                  onChange={(tierId) =>
                    dispatch({ type: "patchCustomerDetails", patch: { tierId } })
                  }
                />
              </div>
            )}
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex h-5 items-center">
                <Label className="text-muted-foreground">Billing address</Label>
              </div>
              <AddressField
                labelPrefix="Billing"
                value={customerDetails.billingAddress}
                onChange={(address) =>
                  dispatch({ type: "patchCustomerDetails", patch: { billingAddress: address } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex h-5 items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="delivery"
                    checked={hasDeliveryAddress}
                    onCheckedChange={(checked) =>
                      dispatch({ type: "patch", patch: { hasDeliveryAddress: checked === true } })
                    }
                  />
                  <Label htmlFor="delivery" className="text-muted-foreground">
                    Delivery address
                  </Label>
                </div>
                {hasDeliveryAddress && (
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
              {hasDeliveryAddress &&
                (deliverySameAsBilling ? (
                  <p className="text-muted-foreground flex h-8 items-center text-sm">
                    Same as billing address
                  </p>
                ) : (
                  <AddressField
                    labelPrefix="Delivery"
                    value={customerDetails.deliveryAddress}
                    onChange={(address) =>
                      dispatch({
                        type: "patchCustomerDetails",
                        patch: { deliveryAddress: address },
                      })
                    }
                  />
                ))}
            </div>
          </div>
        </div>
      ) : (
        <CustomerPicker
          search
          customers={customers}
          linkedCustomer={undefined}
          onPick={handlePickCustomer}
          onCreate={handleCreateNew}
        />
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}

function CustomerPicker({
  customers,
  linkedCustomer,
  unlinkedLabel = "Saved customers",
  onPick,
  onCreate,
  search = false,
}: {
  customers: Customer[];
  linkedCustomer: Customer | undefined;
  /** What the switcher reads while it points at no saved customer. */
  unlinkedLabel?: string;
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

  // Closing normally hands focus back to the trigger. Creating a customer hands
  // it to the field the search text landed in instead, so the popover has to be
  // told not to take it back.
  const keepFocus = useRef(false);

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
              unlinkedLabel
            )}
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className={search ? "w-(--radix-popover-trigger-width) p-1" : "w-72 p-1"}
        align="start"
        onCloseAutoFocus={(event) => {
          if (!keepFocus.current) return;
          keepFocus.current = false;
          event.preventDefault();
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search customers..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-none overflow-visible">
            {filtered.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-sm">No customers found.</p>
            )}
            {filtered.length > 0 && (
              <CommandGroup className="max-h-64 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-y-auto">
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
                  keepFocus.current = true;
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
