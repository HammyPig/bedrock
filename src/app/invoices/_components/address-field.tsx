"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { addressHasContent, formatAddressOneLine } from "../_lib/invoice";
import { mockAddressSuggestions } from "../_lib/mock-data";
import { type Address } from "../_lib/types";

interface AddressFieldProps {
  /** Used for accessible labels, e.g. "Billing" -> "Billing address line 1". */
  labelPrefix: string;
  value: Address;
  onChange: (address: Address) => void;
}

function lookupSuggestions(query: string): Address[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 1) return [];
  return mockAddressSuggestions
    .filter((address) => formatAddressOneLine(address).toLowerCase().includes(trimmed))
    .slice(0, 5);
}

function SuggestionDropdown({
  suggestions,
  onPick,
}: {
  suggestions: Address[];
  onPick: (address: Address) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="bg-popover ring-foreground/10 absolute z-10 mt-1 w-full overflow-hidden rounded-lg p-1 shadow-md ring-1">
      {suggestions.map((address) => {
        const label = formatAddressOneLine(address);
        return (
          <button
            key={label}
            type="button"
            className="hover:bg-muted block w-full rounded-sm px-2 py-1.5 text-left text-sm"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(address);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Focus-driven address entry. Empty -> lookup search with autocomplete.
 * Filled -> a single field showing the formatted address, which expands into
 * structured fields on focus and collapses back when focus leaves the group.
 * Address line 1 doubles as the lookup field while expanded. The lookup is
 * mocked; swap mockAddressSuggestions for a real service.
 */
export function AddressField({ labelPrefix, value, onChange }: AddressFieldProps) {
  /** "auto" shows the collapsed display when the address has content, else the search UI. */
  const [view, setView] = useState<"fields" | "search" | "auto">("auto");
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const setField = (field: keyof Address, fieldValue: string) =>
    onChange({ ...value, [field]: fieldValue });

  const expand = () => setView("fields");

  const startSearch = () => {
    setSearchQuery("");
    setView("search");
  };

  if (view === "fields") {
    return (
      <div
        className="space-y-2"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setView("auto");
        }}
      >
        <div className="relative">
          <Input
            autoFocus
            placeholder="Address line 1"
            aria-label={`${labelPrefix} address line 1`}
            value={value.line1}
            onChange={(e) => {
              setField("line1", e.currentTarget.value);
              setDropdownOpen(true);
            }}
            onBlur={() => setDropdownOpen(false)}
          />
          {dropdownOpen && (
            <SuggestionDropdown
              suggestions={lookupSuggestions(value.line1)}
              onPick={(address) => {
                onChange(address);
                setDropdownOpen(false);
              }}
            />
          )}
        </div>
        <Input
          placeholder="Address line 2 (optional)"
          aria-label={`${labelPrefix} address line 2`}
          value={value.line2}
          onChange={(e) => setField("line2", e.currentTarget.value)}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_5rem] gap-2">
          <Input
            placeholder="Suburb"
            aria-label={`${labelPrefix} suburb`}
            value={value.suburb}
            onChange={(e) => setField("suburb", e.currentTarget.value)}
          />
          <Input
            placeholder="State"
            aria-label={`${labelPrefix} state`}
            value={value.state}
            onChange={(e) => setField("state", e.currentTarget.value)}
          />
          <Input
            placeholder="Postcode"
            aria-label={`${labelPrefix} postcode`}
            inputMode="numeric"
            value={value.postcode}
            onChange={(e) => setField("postcode", e.currentTarget.value)}
          />
        </div>
        <Button
          variant="link"
          size="sm"
          className="text-muted-foreground h-auto p-0"
          onClick={startSearch}
        >
          <SearchIcon />
          Search address
        </Button>
      </div>
    );
  }

  if (view === "auto" && addressHasContent(value)) {
    return (
      <Input
        readOnly
        className="truncate"
        aria-label={`${labelPrefix} address`}
        value={formatAddressOneLine(value)}
        onFocus={expand}
      />
    );
  }

  return (
    <div
      className="space-y-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setView("auto");
      }}
    >
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          autoFocus={view === "search"}
          className="pl-8"
          placeholder="Start typing an address..."
          aria-label={`${labelPrefix} address search`}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.currentTarget.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setDropdownOpen(false)}
        />
        {dropdownOpen && (
          <SuggestionDropdown
            suggestions={lookupSuggestions(searchQuery)}
            onPick={(address) => {
              onChange(address);
              setSearchQuery("");
              setDropdownOpen(false);
              setView("auto");
            }}
          />
        )}
      </div>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={expand}>
        Enter address manually
      </Button>
    </div>
  );
}
